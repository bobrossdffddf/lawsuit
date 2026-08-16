'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

const hasRole = (member, roleId) => Boolean(roleId) && member?.roles?.cache?.has(roleId);

/** Server administrators always pass every check. */
const isAdmin = (member) =>
  Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));

/**
 * Court decisions are gated on the CLERK ROLE, not on Discord permissions.
 * Having Administrator does not make you a clerk — set ADMIN_OVERRIDE=true in
 * .env if you want that back.
 */
const override = (member) => config.adminOverride && isAdmin(member);

const isClerk = (member) => hasRole(member, config.roles.clerk) || override(member);
const isJudge = (member) => hasRole(member, config.roles.judge) || override(member);
const isLawyer = (member) => hasRole(member, config.roles.lawyer) || override(member);

/** Clerks, judges and admins — the "court staff" tier. */
const isStaff = (member) => isClerk(member) || isJudge(member);

/** Who may post the public lawsuit panel. */
const canPostPanel = (member) => {
  if (isAdmin(member)) return true;
  if (config.roles.panelManager) return hasRole(member, config.roles.panelManager);
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
};

module.exports = { isAdmin, isClerk, isJudge, isLawyer, isStaff, canPostPanel, hasRole };
