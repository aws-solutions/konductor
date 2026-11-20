'use strict';

const { notFound } = require('../errors');
const { requiredText } = require('../util/validate');
const { isoNow } = require('../util/date');

function createCommentHandlers(store) {
  return {
    list(issueId) {
      if (!store.findIssue(issueId)) throw notFound('Issue not found');
      return store.listComments(issueId);
    },
    create(issueId, body) {
      if (!store.findIssue(issueId)) throw notFound('Issue not found');
      const comment = { id: `COM-${store.comments.length + 1}`, issueId, authorId: 'u-1', body: requiredText(body.body, 'body'), createdAt: isoNow() };
      return store.addComment(comment);
    },
  };
}

module.exports = { createCommentHandlers };
