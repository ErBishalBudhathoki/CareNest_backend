'use strict';

/**
 * emailService.js — Thin re-export shim.
 *
 * All callers use require('./emailService'). This file now delegates
 * to ListmonkService so the transport can be changed without touching
 * every consumer.
 *
 * Public interface (unchanged):
 *   sendEmail(to, subject, html, attachments?)
 *   addSubscriber(email, name, listIds?)
 *   getReceiptTemplate(...)
 *   getRefundTemplate(...)
 */

module.exports = require('./listmonkService');
