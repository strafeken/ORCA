const { ConversationService } = require('../services/ConversationService');
const { system } = require('../utils/winstonLogger');

/**
 * ConversationController — HTTP layer for the consult inbox / detail / start.
 * Handles request parsing + validation (400s) and maps service outcomes to
 * status codes; all business logic lives in ConversationService.
 *
 * Handlers are bound in the constructor so they can be passed directly as
 * Express handlers.
 */
class ConversationController {
  constructor(conversationService = new ConversationService()) {
    this.service = conversationService;
    this.list = this.list.bind(this);
    this.create = this.create.bind(this);
    this.get = this.get.bind(this);
  }

  async list(req, res) {
    try {
      const conversations = await this.service.getInbox(req.user.id, req.user.role === 'worker');
      res.json({ conversations });
    } catch (err) {
      system.error('Failed to list conversations', { context: 'conversations', error: err.message });
      res.status(500).json({ error: 'Could not load conversations.' });
    }
  }

  async create(req, res) {
    const expertId = parseInt(req.body.expertId, 10);
    if (!Number.isInteger(expertId) || expertId < 1) {
      return res.status(400).json({ error: 'A valid expert ID is required.' });
    }
    if (expertId === req.user.id) {
      return res.status(400).json({ error: 'Cannot start a consultation with yourself.' });
    }

    try {
      const result = await this.service.startConversation(req.user.id, expertId);
      if (!result) {
        return res.status(404).json({ error: 'Expert not found or not available.' });
      }
      // Real-time: on a brand-new conversation, notify both participants'
      // personal socket rooms so an open consult list updates without a manual
      // refresh (merged from the real-time feature). The socket io instance is
      // attached to the app in server.js.
      if (result.created) {
        const io = req.app.get('io');
        if (io) {
          const conversationId = result.conversation.id;
          io.to(`user:${expertId}`).emit('conversation:new', { conversationId });
          io.to(`user:${req.user.id}`).emit('conversation:new', { conversationId });
        }
      }
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      system.error('Failed to create conversation', { context: 'conversations', error: err.message });
      res.status(500).json({ error: 'Could not start consultation.' });
    }
  }

  async get(req, res) {
    const conversationId = parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      return res.status(400).json({ error: 'Invalid conversation ID.' });
    }

    try {
      const conversation = await this.service.getConversation(
        conversationId, req.user.id, req.user.role
      );
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found.' });
      }
      res.json({ conversation });
    } catch (err) {
      system.error('Failed to read conversation', { context: 'conversations', error: err.message });
      res.status(500).json({ error: 'Could not load conversation.' });
    }
  }
}

module.exports = { ConversationController };
