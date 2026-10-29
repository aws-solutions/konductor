'use strict';

const { createRepo } = require('./repo');
const { normalizeInput, ValidationError } = require('./model');
const { toJson, toCsv } = require('./serialize');

function createContactService() {
  const repo = createRepo();
  const service = {
    create(input) {
      const fields = normalizeInput(input);
      const contact = { id: repo.nextId(), ...fields };
      repo.save(contact);
      return toJson(contact);
    },
    get(id) {
      const c = repo.find(id);
      return c ? toJson(c) : null;
    },
    update(id, patch) {
      const current = repo.find(id);
      if (!current) return null;
      Object.assign(current, normalizeInput(patch, { partial: true }));
      repo.save(current);
      return toJson(current);
    },
    list({ sort = 'displayName' } = {}) {
      const key = sort === 'fullName' ? 'displayName' : sort;
      return repo.all().slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)).map(toJson);
    },
    search(q) {
      const needle = String(q).trim().toLowerCase();
      if (!needle) return [];
      return repo.searchIds(needle).map((id) => toJson(repo.find(id)));
    },
    exportCsv() {
      return toCsv(service.list());
    },
  };
  return service;
}

module.exports = { createContactService };
