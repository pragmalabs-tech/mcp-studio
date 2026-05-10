/**
 * Profiles API client. Talks to Studio's local Rust backend at the
 * same origin; profiles persist in `~/.mcp-studio/profiles.json`.
 */

/**
 * Auth a profile carries. Bearer/custom values live in the profile so
 * switching profile = switching auth (multi-identity per origin). The
 * "oauth" variant is a marker only: actual tokens stay in localStorage
 * keyed by origin because the OAuth callback page has no profile context.
 */
export type ProfileAuth =
  | { method: "none" }
  | { method: "bearer"; token: string }
  | { method: "custom"; headers: Record<string, string> }
  | { method: "oauth" };

export interface Profile {
  id: string;
  name: string;
  server_url: string;
  auth?: ProfileAuth;
}

export interface ProfilesResponse {
  profiles: Profile[];
  active_id: string | null;
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* fall through to status code */
    }
    throw new Error(detail);
  }
  return resp.json() as Promise<T>;
}

export async function listProfiles(): Promise<ProfilesResponse> {
  return asJson<ProfilesResponse>(await fetch("/api/studio/profiles"));
}

export async function createProfile(input: {
  name: string;
  server_url?: string;
  auth?: ProfileAuth;
}): Promise<Profile> {
  return asJson<Profile>(
    await fetch("/api/studio/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        server_url: input.server_url ?? "",
        auth: input.auth,
      }),
    }),
  );
}

/**
 * `auth: undefined` leaves the field alone. To clear auth, send `auth: null`.
 * Mirrors the backend's `Option<Option<ProfileAuth>>` semantics.
 */
export async function updateProfile(
  id: string,
  patch: {
    name?: string;
    server_url?: string;
    auth?: ProfileAuth | null;
  },
): Promise<Profile> {
  return asJson<Profile>(
    await fetch(`/api/studio/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteProfile(id: string): Promise<void> {
  const resp = await fetch(`/api/studio/profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 204) {
    let detail = `${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* fall through */
    }
    throw new Error(detail);
  }
}

export async function activateProfile(id: string): Promise<ProfilesResponse> {
  return asJson<ProfilesResponse>(
    await fetch(`/api/studio/profiles/${encodeURIComponent(id)}/activate`, {
      method: "POST",
    }),
  );
}
