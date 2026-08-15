'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

const hasRole = (member, roleId) => Boolean(roleId) && member?.roles?.cache?.has(roleId);

/** Server administrators always pass every check. */
const isAdmin = (member) =>
  Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));

const isClerk = (member) => isAdmin(member) || hasRole(member, config.roles.clerk);
const isJudge = (member) => isAdmin(member) || hasRole(member, config.roles.judge);

/** Clerks, judges and admins — the "court staff" tier. */
const isStaff = (member) => isClerk(member) || isJudge(member);

/** Who may post the public lawsuit panel. */
const canPostPanel = (member) => {
  if (isAdmin(member)) return true;
  if (config.roles.panelManager) return hasRole(member, config.roles.panelManager);
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
};

module.exports = { isAdmin, isClerk, isJudge, isStaff, canPostPanel, hasRole };
