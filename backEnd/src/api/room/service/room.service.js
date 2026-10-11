

import { safeExecute } from "../../../../schema/db.config.js";
import { NotFoundError } from "../../../utility/errors/errors.js";



const ROOM_SELECT = `
  SELECT
    r.room_id, r.name, r.description, r.created_at,
    (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.room_id) AS member_count,
    (SELECT COUNT(*) FROM room_messages g WHERE g.room_id = r.room_id) AS message_count,
    COALESCE(
      ( SELECT MAX(g2.created_at) FROM room_messages g2 WHERE g2.room_id = r.room_id),
      r.created_at
      )AS last_activity_at,
    EXISTS(
      SELECT 1 FROM room_members me WHERE me.room_id = r.room_id AND me.user_id = ?
    ) AS is_member
  FROM rooms r`;

// toRoom: convert a row from the database into a room object for the API.

const toRoom = (row) => ({
  id: row.room_id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  memberCount: Number(row.member_count),
  messageCount: Number(row.message_count),
  lastActivityAt: row.last_activity_at,
  isMember: Boolean(row.is_member),
});

/**
 * Every room, newest activity first.
 * @param {number} userId - The user who is asking (for isMember).
 * @returns {Promise<Array<Object>>}
 */
const listRoomsService = async (userId) => {
  const rows = await safeExecute(
    `${ROOM_SELECT}
  ORDER BY last_activity_at DESC, r.room_id ASC`,
    [userId],
  );
  return rows.map(toRoom);
};

/**
 * One room by id.
 * @param {{ roomId: number, userId: number }} param
 * @returns {Promise<Object>}
 * @throws {NotFoundError} If the room does not exist.
 */
const getRoomService = async ({ roomId, userId }) => {
  const rows = await safeExecute(
    `${ROOM_SELECT}
  WHERE r.room_id = ?`,
    [userId, roomId],
  );
  if (rows.length === 0) {
    throw new NotFoundError("Room not found");
  }
  return toRoom(rows[0]);
};

export { listRoomsService, getRoomService };
