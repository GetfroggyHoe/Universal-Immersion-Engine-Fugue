export const DEFAULT_PARTY_PORTRAITS = Object.freeze({
  feminine: "assets/ui/generated/Sil-F.png",
  masculine: "assets/ui/generated/Sil-M.png",
  party: "assets/ui/generated/PartySil.png",
});

function memberName(member) {
  return String(member?.identity?.name || member?.name || "").trim();
}

function isLikelyUserMember(settings, member) {
  const roles = Array.isArray(member?.roles) ? member.roles.map((role) => String(role || "").toLowerCase()) : [];
  if (roles.includes("user") || member?.isUser === true) return true;
  const memberKey = memberName(member).toLowerCase();
  const userKey = String(settings?.character?.name || settings?.name || "").trim().toLowerCase();
  return !!memberKey && !!userKey && memberKey === userKey;
}

export function findLinkedSocialFriend(settings, member) {
  const nm = memberName(member).toLowerCase();
  if (!nm) return null;
  const friends = Array.isArray(settings?.social?.friends) ? settings.social.friends : [];
  return friends.find((friend) => String(friend?.name || "").trim().toLowerCase() === nm) || null;
}

function findLinkedCharacterCard(settings, member) {
  const nm = memberName(member).toLowerCase();
  if (!nm) return null;
  const cards = Array.isArray(settings?.character_cards) ? settings.character_cards : [];
  return cards.find((card) => String(card?.name || card?.title || "").trim().toLowerCase() === nm) || null;
}

export function inferDefaultPartyPortraitKind(settings, member) {
  const friend = findLinkedSocialFriend(settings, member);
  const card = findLinkedCharacterCard(settings, member);
  const hints = [
    member?.identity?.gender,
    member?.identity?.sex,
    member?.gender,
    member?.sex,
    friend?.gender,
    friend?.sex,
    card?.gender,
    card?.sex,
  ];

  for (const hint of hints) {
    const text = String(hint || "").trim().toLowerCase();
    if (!text) continue;
    if (/\b(woman|female|girl|feminine|lady|mother|sister|daughter|wife|queen|princess)\b|she[/-]her/.test(text)) return "feminine";
    if (/\b(man|male|boy|masculine|gentleman|father|brother|son|husband|king|prince)\b|he[/-]him/.test(text)) return "masculine";
  }

  const seedText = String(member?.id || memberName(member) || "member");
  const seed = seedText.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return seed % 2 === 0 ? "feminine" : "masculine";
}

export function defaultPartyPortraitUrl(settings, member) {
  if (member?.partySilhouette === true || member?.usePartySilhouette === true) return DEFAULT_PARTY_PORTRAITS.party;
  return DEFAULT_PARTY_PORTRAITS[inferDefaultPartyPortraitKind(settings, member)] || DEFAULT_PARTY_PORTRAITS.masculine;
}

function resolveCharacterPortraitReference(settings, directRaw) {
  const match = String(directRaw || "").trim().match(/^<char(?::([^>]+))?>$/i);
  if (!match) return String(directRaw || "").trim();

  const want = String(match[1] || "").trim().toLowerCase();
  if (!want) return "";

  const friends = Array.isArray(settings?.social?.friends) ? settings.social.friends : [];
  const friend = friends.find((item) => String(item?.name || "").trim().toLowerCase() === want) || null;
  const friendAvatar = String(friend?.avatar || friend?.img || "").trim();
  if (friendAvatar) return friendAvatar;

  const members = Array.isArray(settings?.party?.members) ? settings.party.members : [];
  const partyMember = members.find((item) => memberName(item).toLowerCase() === want) || null;
  const memberPortrait = String(partyMember?.images?.portrait || partyMember?.imageUrl || partyMember?.sprite || "").trim();
  if (memberPortrait && !/^<char(?::[^>]+)?>$/i.test(memberPortrait)) return memberPortrait;

  return "";
}

export function resolvePartyPortraitUrl(settings, member, options = {}) {
  const direct = resolveCharacterPortraitReference(settings, member?.images?.portrait || member?.imageUrl || member?.sprite || "");
  const isSilhouette = (url) => {
    return url && (url.includes("PartySil.png") || url.includes("Sil-F.png") || url.includes("Sil-M.png"));
  };

  if (direct && !isSilhouette(direct)) return direct;

  const friend = findLinkedSocialFriend(settings, member);
  const friendAvatar = String(friend?.avatar || friend?.img || "").trim();
  if (friendAvatar && !isSilhouette(friendAvatar)) return friendAvatar;

  const shouldUseUserAvatar = options.isUser === true || (options.isUser !== false && isLikelyUserMember(settings, member));
  let userAvatar = "";
  if (shouldUseUserAvatar) {
    userAvatar = String(settings?.character?.avatar || settings?.character?.portrait || "").trim();
    if (userAvatar && !isSilhouette(userAvatar)) return userAvatar;
  }

  if (direct) return direct;
  if (friendAvatar) return friendAvatar;
  if (userAvatar) return userAvatar;

  if (options.party === true) return DEFAULT_PARTY_PORTRAITS.party;
  return defaultPartyPortraitUrl(settings, member);
}
