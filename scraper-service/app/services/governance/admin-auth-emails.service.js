"use strict";

const LIST_USERS_PAGE_SIZE = 1000;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} page
 * @returns {Promise<{ users: Array<{ id: string, email?: string | null }> }>}
 */
async function listAuthUsersPage(supabase, page) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage: LIST_USERS_PAGE_SIZE,
  });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list auth users"), {
      statusCode: 500,
    });
  }

  return {
    users: Array.isArray(data?.users) ? data.users : [],
  };
}

/**
 * Resolve emails for specific user ids via paginated auth.admin.listUsers (early exit).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string | null>>}
 */
async function fetchEmailsForUserIds(supabase, userIds) {
  /** @type {Map<string, string | null>} */
  const emailById = new Map();

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return emailById;
  }

  /** @type {Set<string>} */
  const pending = new Set(userIds.map((id) => String(id)));

  let page = 1;
  while (pending.size > 0) {
    const { users } = await listAuthUsersPage(supabase, page);
    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      const id = String(user.id);
      if (!pending.has(id)) {
        continue;
      }
      emailById.set(id, user.email ?? null);
      pending.delete(id);
    }

    if (users.length < LIST_USERS_PAGE_SIZE) {
      break;
    }
    page += 1;
  }

  for (const id of pending) {
    emailById.set(id, null);
  }

  return emailById;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
async function fetchEmailForUserId(supabase, userId) {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    return null;
  }

  return data.user.email ?? null;
}

/**
 * Find auth user ids whose email contains the search term (case-insensitive).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} search
 * @returns {Promise<string[]>}
 */
async function findUserIdsByEmailSearch(supabase, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) {
    return [];
  }

  /** @type {string[]} */
  const matchedIds = [];
  let page = 1;

  while (true) {
    const { users } = await listAuthUsersPage(supabase, page);
    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      const email = String(user.email || "").toLowerCase();
      if (email.includes(term)) {
        matchedIds.push(String(user.id));
      }
    }

    if (users.length < LIST_USERS_PAGE_SIZE) {
      break;
    }
    page += 1;
  }

  return matchedIds;
}

module.exports = {
  fetchEmailsForUserIds,
  fetchEmailForUserId,
  findUserIdsByEmailSearch,
};
