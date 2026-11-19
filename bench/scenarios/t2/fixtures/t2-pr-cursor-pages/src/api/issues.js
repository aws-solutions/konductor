'use strict';

const { notFound } = require('../errors');
const { encodeCursor, decodeCursor } = require('../pagination/cursor');

function createIssueHandlers(store, config) {
  return {
    list(searchParams) {
      const limitValue = Number.parseInt(searchParams.get('limit') || config.defaultPageSize, 10);
      const limit = Number.isInteger(limitValue) && limitValue > 0 ? limitValue : config.defaultPageSize;
      const items = store.listIssues({
        status: searchParams.get('status') || undefined,
        assigneeId: searchParams.get('assignee') || undefined,
      });
      items.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const indexed = items.map((issue, rowOffset) => ({ ...issue, _rowOffset: rowOffset }));
      const start = decodeCursor(searchParams.get('cursor'));
      const page = indexed.filter((issue) => issue._rowOffset >= start).slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = last && start + page.length < indexed.length ? encodeCursor(last._rowOffset) : undefined;
      return {
        data: page.map(({ _rowOffset, ...issue }) => issue),
        page: { nextCursor },
      };
    },
    get(id) {
      const issue = store.findIssue(id);
      if (!issue) throw notFound('Issue not found');
      return issue;
    },
  };
}

module.exports = { createIssueHandlers };
