/**
 * Profiles API client. Talks to Studio's local Rust backend at the
 * same origin; profiles persist in `~/.mcp-studio/profiles.json`.
 */

export interface Profile {
  id: string;
  name: string;
  server_url: string;
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
}): Promise<Profile> {
  return asJson<Profile>(
    await fetch("/api/studio/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        server_url: input.server_url ?? "",
      }),
    }),
  );
}

export async function updateProfile(
  id: string,
  patch: { name?: string; server_url?: string },
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
