"use strict";

const { FuseVersion, FuseV1Options } = require("@electron/fuses");

/**
 * Cookie store encryption requires Keychain access on macOS, which fails
 * for unsigned builds. Linux (libsecret) and Windows (DPAPI) have no such
 * constraint. Other fuses are platform-agnostic.
 *
 * Order: afterPack runs before doAddElectronFuses, which short-circuits
 * because electronFuses is unset in the YAML. No double-write.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const isMac = platform === "darwin" || platform === "mas";

  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: !isMac,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
};
