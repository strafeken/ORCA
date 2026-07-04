const { ConversationRepository } = require('../repositories/ConversationRepository');
const { UserRepository } = require('../repositories/UserRepository');

/**
 * ConversationService — business logic for the consult inbox and starting a
 * consultation (FR). Owns the "reuse an existing conversation vs create a new
 * one" rule and the role-based counterpart shaping, so the controller stays
 * HTTP-only and the repositories stay SQL-only.
 *
 * Repositories are injected (defaulting to real ones) for unit testing.
 */
class ConversationService {
  constructor(
    conversationRepository = new ConversationRepository(),
    userRepository = new UserRepository()
  ) {
    this.conversations = conversationRepository;
    this.users = userRepository;
  }

  /** Inbox rows for a worker or expert. */
  getInbox(userId, isWorker) {
    return this.conversations.listInbox(userId, isWorker);
  }

  /**
   * Start (or re-open) a consultation between a worker and an approved expert.
   * @returns {null} if the expert isn't available (caller → 404), otherwise
   *   { conversation, created } where created=false means an existing thread
   *   was returned.
   */
  async startConversation(workerId, expertId) {
    const expert = await this.users.findAvailableExpertById(expertId);
    if (!expert) return null;

    const existing = await this.conversations.findByWorkerAndExpert(workerId, expertId);
    if (existing) {
      return {
        conversation: await this.conversations.findDetailedForUser(existing.id, workerId),
        created: false,
      };
    }

    const newId = await this.conversations.create(workerId, expertId);
    return {
      conversation: await this.conversations.findDetailedForUser(newId, workerId),
      created: true,
    };
  }

  /**
   * Participant-scoped conversation metadata, with the counterpart resolved by
   * the caller's role. Returns null if not found / not a participant.
   */
  async getConversation(conversationId, userId, role) {
    const row = await this.conversations.findDetailedForUser(conversationId, userId);
    if (!row) return null;

    const isWorker = role === 'worker';
    return {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      counterpart: isWorker
        ? { id: row.expert_id, name: row.expert_name, role: 'expert', bio: row.expert_bio }
        : { id: row.worker_id, name: row.worker_name, role: 'worker' },
    };
  }
}

module.exports = { ConversationService };
