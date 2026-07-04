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
	room      []byte
	overlayID []byte

	mu    sync.RWMutex
	peers map[string]*peerState
}

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

func (a *anchor) onConnect(peer adnl.Peer) error {
	w := overlay.CreateExtendedADNL(peer).WithOverlay(a.overlayID)
	id := hex.EncodeToString(peer.GetID())

	a.mu.Lock()
	a.peers[id] = &peerState{w: w}
	a.mu.Unlock()

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

func (a *anchor) countMembersLocked() int {
	n := 0
	for _, ps := range a.peers {
		if ps.member {
			n++
		}
	}
	return n
}

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
