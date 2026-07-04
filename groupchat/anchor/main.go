// groupchat-anchor is a standalone, always-on seed/relay node for the experimental
// Tonnet group chat. It is NOT the tonutils-bridge and does NOT touch it: it opens
// its own ADNL gateway on a dedicated UDP port, hosts a single public overlay
// (the "room"), relays messages between connected peers (star/hub topology), and
// publishes itself to the DHT so browser clients can discover and reach it.
//
// groupchat.ton's site record should point at this node's ADNL id (printed on start).
//
// MVP scope: live relay only (no persisted history — see CHANGELOG, planned v2).
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"flag"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/xssnick/tonutils-go/adnl"
	"github.com/xssnick/tonutils-go/adnl/dht"
	"github.com/xssnick/tonutils-go/adnl/keys"
	"github.com/xssnick/tonutils-go/adnl/overlay"
	"github.com/xssnick/tonutils-go/tl"
)

// RawMessage mirrors tonutils-bridge's ws.rawMessage so chat payloads relayed by
// the anchor decode symmetrically on browser clients (which go through the bridge's
// overlay.sendMessage / overlay.message path).
type RawMessage struct {
	Data []byte `tl:"bytes"`
}

func init() {
	tl.Register(RawMessage{}, "ws.rawMessage data:bytes = ws.RawMessage")
}

const (
	defaultRoom   = "tonnet:groupchat:v1"
	republishEach = 5 * time.Minute
	recordTTL     = 30 * time.Minute
)

type anchor struct {
	gw        *adnl.Gateway
	key       ed25519.PrivateKey
	room      []byte // raw overlay descriptor name (StoreOverlayNodes hashes it itself)
	overlayID []byte // tl.Hash(pub.overlay{name: room})

	mu    sync.RWMutex
	peers map[string]*peerState
}

// peerState tracks a connected ADNL peer. `member` flips to true the first time
// the peer sends overlay-prefixed traffic (a hello or a chat message). Passing
// DHT nodes share the same gateway and trigger onConnect too, but never send
// overlay messages — so they stay non-members and never enter the relay set.
type peerState struct {
	w      *overlay.ADNLOverlayWrapper
	member bool
}

func main() {
	listen := flag.String("listen", "", "public UDP listen address ip:port (required)")
	keyPath := flag.String("key", "anchor-key.bin", "path to 32-byte ed25519 seed (created if missing)")
	cfgURL := flag.String("config", "https://ton-blockchain.github.io/global.config.json", "TON global config url")
	room := flag.String("room", defaultRoom, "room name (overlay descriptor)")
	flag.Parse()

	if *listen == "" {
		log.Fatal("-listen ip:port is required")
	}

	key := loadOrCreateKey(*keyPath)

	overlayID, err := tl.Hash(keys.PublicKeyOverlay{Key: []byte(*room)})
	if err != nil {
		log.Fatalf("compute overlay id: %v", err)
	}

	gw := adnl.NewGateway(key)
	a := &anchor{gw: gw, key: key, room: []byte(*room), overlayID: overlayID, peers: map[string]*peerState{}}
	gw.SetConnectionHandler(a.onConnect)

	if err := gw.StartServer(*listen); err != nil {
		log.Fatalf("start server on %s: %v", *listen, err)
	}

	adnlID := gw.GetID()
	log.Printf("================ groupchat anchor ================")
	log.Printf("room        : %q", *room)
	log.Printf("ADNL id b64 : %s", base64.StdEncoding.EncodeToString(adnlID))
	log.Printf("ADNL id hex : %s", hex.EncodeToString(adnlID))
	log.Printf("overlay id  : %s", base64.StdEncoding.EncodeToString(overlayID))
	log.Printf("listen      : %s", *listen)
	log.Printf("=> set groupchat.ton site record to the ADNL id above")
	log.Printf("=================================================")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dhtClient, err := dht.NewClientFromConfigUrl(ctx, gw, *cfgURL)
	if err != nil {
		log.Fatalf("dht client: %v", err)
	}
	go a.republishLoop(ctx, dhtClient)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down")
}

// onConnect wraps each incoming peer in the room overlay. A peer only enters the
// relay set once it actually speaks the overlay (markMember), which keeps the
// hub fan-out scoped to real room members and off the transient DHT nodes that
// share this gateway. The sender is always skipped when relaying.
func (a *anchor) onConnect(peer adnl.Peer) error {
	w := overlay.CreateExtendedADNL(peer).WithOverlay(a.overlayID)
	id := hex.EncodeToString(peer.GetID())

	a.mu.Lock()
	a.peers[id] = &peerState{w: w}
	a.mu.Unlock()

	// markMember promotes the peer to a room member the first time it sends
	// overlay traffic, logging the join once.
	markMember := func() {
		a.mu.Lock()
		ps := a.peers[id]
		newly := ps != nil && !ps.member
		if newly {
			ps.member = true
		}
		n := a.countMembersLocked()
		a.mu.Unlock()
		if newly {
			log.Printf("member joined %s… (members %d)", short(id), n)
		}
	}

	relay := func(data tl.Serializable) {
		markMember()
		a.mu.RLock()
		wraps := make([]*overlay.ADNLOverlayWrapper, 0, len(a.peers))
		for pid, ps := range a.peers {
			if pid != id && ps.member {
				wraps = append(wraps, ps.w)
			}
		}
		a.mu.RUnlock()
		for _, pw := range wraps {
			cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if err := pw.SendCustomMessage(cctx, data); err != nil {
				log.Printf("relay from %s… failed: %v", short(id), err)
			}
			cancel()
		}
	}

	w.SetCustomMessageHandler(func(msg *adnl.MessageCustom) error {
		relay(msg.Data)
		return nil
	})
	w.SetBroadcastHandler(func(msg tl.Serializable, trusted bool) error {
		relay(msg)
		return nil
	})
	w.SetDisconnectHandler(func(addr string, k ed25519.PublicKey) {
		a.mu.Lock()
		ps := a.peers[id]
		wasMember := ps != nil && ps.member
		delete(a.peers, id)
		n := a.countMembersLocked()
		a.mu.Unlock()
		if wasMember {
			log.Printf("member left   %s… (members %d)", short(id), n)
		}
	})
	return nil
}

// countMembersLocked returns the number of real room members. Caller holds a.mu.
func (a *anchor) countMembersLocked() int {
	n := 0
	for _, ps := range a.peers {
		if ps.member {
			n++
		}
	}
	return n
}

// republishLoop keeps the anchor discoverable: it stores its ADNL address (so the
// ADNL id resolves to ip:port) and registers itself as a member of the room overlay.
func (a *anchor) republishLoop(ctx context.Context, d *dht.Client) {
	publish := func() {
		cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()

		if _, _, err := d.StoreAddress(cctx, a.gw.GetAddressList(), recordTTL, a.key); err != nil {
			log.Printf("dht storeAddress: %v", err)
		}

		node := overlay.Node{
			ID:      keys.PublicKeyED25519{Key: a.key.Public().(ed25519.PublicKey)},
			Overlay: a.overlayID,
			Version: int32(time.Now().Unix()),
		}
		if err := node.Sign(a.key); err != nil {
			log.Printf("sign overlay node: %v", err)
			return
		}
		nodes := &overlay.NodesList{List: []overlay.Node{node}}
		if _, _, err := d.StoreOverlayNodes(cctx, a.room, nodes, recordTTL); err != nil {
			log.Printf("dht storeOverlayNodes: %v", err)
			return
		}
		log.Printf("republished to DHT (address + overlay node)")
	}

	publish()
	t := time.NewTicker(republishEach)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			publish()
		}
	}
}

func loadOrCreateKey(path string) ed25519.PrivateKey {
	if b, err := os.ReadFile(path); err == nil {
		switch len(b) {
		case ed25519.SeedSize:
			return ed25519.NewKeyFromSeed(b)
		case ed25519.PrivateKeySize:
			return ed25519.PrivateKey(b)
		default:
			log.Fatalf("key file %s has invalid size %d", path, len(b))
		}
	}
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		log.Fatalf("generate key: %v", err)
	}
	if err := os.WriteFile(path, seed, 0o600); err != nil {
		log.Fatalf("write key %s: %v", path, err)
	}
	log.Printf("generated new anchor key at %s", path)
	return ed25519.NewKeyFromSeed(seed)
}

func short(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
