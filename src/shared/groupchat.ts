/**
 * Group chat constants (feature branch: groupchat).
 * See /groupchat/CHANGELOG.md.
 *
 * The chat now joins ANY room by name — the overlay id is derived from the room
 * name at runtime (see src/main/chat/room.ts), no longer a fixed constant. What
 * stays fixed is only the DEFAULT room and its well-known `.ton` anchor, used
 * when the user hasn't picked another room.
 *
 * GROUPCHAT_OVERLAY_ID is the derived id of the default room, kept for reference
 * (= tl.Hash(pub.overlay{ name: GROUPCHAT_ROOM })).
 */
export const GROUPCHAT_DOMAIN = 'groupchat.ton'
export const GROUPCHAT_OVERLAY_ID = 'YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM='
export const GROUPCHAT_ROOM = 'tonnet:groupchat:v1'
