{
  description = "Tonnet Browser - TON network browser development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
        go = pkgs.go_1_24;
      in
      {
        devShells.default = pkgs.mkShell {
          name = "tonnet-browser-dev";
          nativeBuildInputs = [ nodejs go ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.pkg-config
              pkgs.stdenv.cc.cc.lib
            ];

          shellHook = ''
            export NODE_ENV=development
            export PATH="${nodejs}/bin:$PATH"

            # Build Go binaries if missing
            BIN_DIR="resources/bin/$(uname -s | sed 's/^Darwin$/mac/; s/^Linux$/linux/')"
            if [ ! -f "$BIN_DIR/tonutils-storage" ] || [ ! -f "$BIN_DIR/tonutils-proxy" ]; then
              echo "🔨 Building Go binaries (tonutils-storage, tonutils-proxy)..."
              bash scripts/build-binaries-from-source.sh
            fi

            echo ""
            echo "🧅 Tonnet Browser Dev Environment"
            echo "─────────────────────────────────"
            echo ""
            echo "  start    - Start the browser in dev mode"
            echo "  build    - Build for production"
            echo "  lint     - Run ESLint"
            echo "  test     - Run tests"
            echo "  clean    - Remove build artifacts"
            echo ""
          '' + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
              pkgs.nss pkgs.at-spi2-atk pkgs.libsecret
              pkgs.stdenv.cc.cc.lib pkgs.xorg.libxcb
              pkgs.cups pkgs.gtk3 pkgs.alsa-lib
              pkgs.freetype pkgs.fontconfig pkgs.cairo pkgs.pango
              pkgs.libdrm pkgs.mesa pkgs.libGL pkgs.xorg.libX11
              pkgs.xorg.libXcomposite pkgs.xorg.libXdamage
              pkgs.xorg.libXext pkgs.xorg.libXfixes
              pkgs.xorg.libXrandr pkgs.xorg.libxshmfence
              pkgs.libxkbcommon pkgs.dbus pkgs.expat pkgs.atk
            ]}:$LD_LIBRARY_PATH"

            export GTK_PATH="${pkgs.gtk3}/lib/gtk-3.0"
          '';
        };
      }
    );
}
