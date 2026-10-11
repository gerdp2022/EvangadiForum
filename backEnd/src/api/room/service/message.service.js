

import { safeExecute } from "../../../../schema/db.config.js";

const PAGE_SIZE = 50;

const MESSAGE_SELECT = `
  SELECT g.message_id, g.content, g.created_at,
        u.user_id, u.first_name, u.last_name, u.avatar
  FROM room_messages g
  JOIN users u ON u.user_id = g.user_id`;

const toMessage = (row) => ({
  id: row.message_id,
  content: row.content,
  createdAt: row.created_at,
  author: {
    id: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    avatar: row.avatar ?? null,
  },
});

/**
 * The latest 50 messages of ONE room, oldest first (ready to show top to
 * bottom). "room_id = ?" keeps two rooms from ever mixing.
 * @param {number} roomId
 * @returns {Promise<Array<Object>>}
 */
const listMessagesService = async (roomId) => {
  const rows = await safeExecute(
    `${MESSAGE_SELECT}
  WHERE g.room_id = ?
  ORDER BY g.message_id DESC
  LIMIT ${PAGE_SIZE}`,
    [roomId],
  );
  // Newest 50 were read; reverse so the oldest comes first.
  return rows.reverse().map(toMessage);
};

/**
 * Posts one message. The route has already checked that the user is a member.
 *
 * The content is stored exactly as typed (plain text). The front end shows it
 * as text, never as HTML.
 *
 * @param {{ roomId: number, userId: number, content: string }} param
 * @returns {Promise<Object>} The new message.
 */
const postMessageService = async ({ roomId, userId, content }) => {
  const result = await safeExecute(
    "INSERT INTO room_messages (room_id, user_id, content) VALUES (?, ?, ?)",
    [roomId, userId, content],
  );

  const rows = await safeExecute(
    `${MESSAGE_SELECT}
  WHERE g.message_id = ?`,
    [result.insertId],
  );
  return toMessage(rows[0]);
};

export { listMessagesService, postMessageService };
