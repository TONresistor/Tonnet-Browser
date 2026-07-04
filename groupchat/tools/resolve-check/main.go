// resolve-check verifies that groupchat.ton resolves on-chain to the anchor ADNL id.
package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/xssnick/tonutils-go/liteclient"
	"github.com/xssnick/tonutils-go/ton"
	"github.com/xssnick/tonutils-go/ton/dns"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	pool := liteclient.NewConnectionPool()
	if err := pool.AddConnectionsFromConfigUrl(ctx, "https://ton-blockchain.github.io/global.config.json"); err != nil {
		log.Fatalf("config: %v", err)
	}
	api := ton.NewAPIClient(pool)

	root, err := dns.GetRootContractAddr(ctx, api)
	if err != nil {
		log.Fatalf("root: %v", err)
	}
	d := dns.NewDNSClient(api, root)

	dom, err := d.Resolve(ctx, "groupchat.ton")
	if err != nil {
		log.Fatalf("resolve groupchat.ton: %v", err)
	}
	rec, inStorage := dom.GetSiteRecord()
	fmt.Printf("groupchat.ton site record:\n  hex    = %s\n  base64 = %s\n  storage= %v\n",
		hex.EncodeToString(rec), base64.StdEncoding.EncodeToString(rec), inStorage)
}
