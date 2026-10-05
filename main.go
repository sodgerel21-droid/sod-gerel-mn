// E-Property is a Gerege Nexus distribution.
package main

import (
	"log/slog"
	"os"

	"github.com/gerege-systems/nexus-gerege-private/backend/pkg/host"
)

func main() {
	if err := host.Run(host.Options{}); err != nil {
		slog.Error("E-Property stopped", "error", err)
		os.Exit(1)
	}
}
