'use strict';
function memberService(members) { return { invite(input) { return members.invite(input); }, list(id) { return members.list(id); } }; }
module.exports = { memberService };
