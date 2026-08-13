export function personalTenantId(uid: string) {
  return `personal_${uid}`;
}

export function personalWorkspaceId(uid: string) {
  return `personal_${uid}_default`;
}

export function personalMembershipId(uid: string) {
  return `${personalTenantId(uid)}_${uid}`;
}
