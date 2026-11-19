'use strict';

class MemoryStore {
  constructor({ issues = [], comments = [], users = [] } = {}) {
    this.issues = issues.map((item) => ({ ...item }));
    this.comments = comments.map((item) => ({ ...item }));
    this.users = users.map((item) => ({ ...item }));
  }

  listIssues(filters = {}) {
    return this.issues.filter((issue) => {
      if (filters.status && issue.status !== filters.status) return false;
      if (filters.assigneeId && issue.assigneeId !== filters.assigneeId) return false;
      return true;
    });
  }

  findIssue(id) {
    return this.issues.find((issue) => issue.id === id);
  }

  listComments(issueId) {
    return this.comments.filter((comment) => comment.issueId === issueId);
  }

  addComment(comment) {
    this.comments.push({ ...comment });
    return comment;
  }

  listUsers() {
    return [...this.users];
  }

  findUser(id) {
    return this.users.find((user) => user.id === id);
  }
}

module.exports = { MemoryStore };
