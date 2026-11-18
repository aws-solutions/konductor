// SPDX-License-Identifier: Apache-2.0
//
// cli/skills_server.rs: names of the skills MCP server and its skill
// loading tool, shared by install (which wires and grants the server)
// and synth (which tells Kiro agents how to call it).

pub(crate) const MCP_SERVER_NAME: &str = "konductor-skills";
pub(crate) const GET_SKILL_TOOL: &str = "get_skill";
