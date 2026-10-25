#!/usr/bin/env python3
"""
SMTP-to-HTTP Relay for SendPulse

Listens for SMTP connections internally and relays emails via SendPulse REST API.
"""

import asyncio
import base64
import email
import json
import logging
import os
import re
import time
from email.utils import parsedate_to_datetime, formataddr

import urllib.request
import urllib.error

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP as SMTPServer

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('smtp-relay')

# Configuration from environment
SENDPULSE_CLIENT_ID = os.environ.get('SENDPULSE_CLIENT_ID', '')
SENDPULSE_CLIENT_SECRET = os.environ.get('SENDPULSE_CLIENT_SECRET', '')
VERIFIED_SENDER = os.environ.get('VERIFIED_SENDER', 'bishal@bishalbudhathoki.com')
LISTEN_PORT = int(os.environ.get('LISTEN_PORT', '587'))
LISTEN_HOST = os.environ.get('LISTEN_HOST', '0.0.0.0')

# Token cache
_token_data = {'token': None, 'expires_at': 0}


def get_access_token():
    """Get or refresh SendPulse OAuth access token."""
    now = time.time()
    if _token_data['token'] and now < _token_data['expires_at'] - 60:
        return _token_data['token']

    url = 'https://api.sendpulse.com/oauth/access_token'
    payload = json.dumps({
        'grant_type': 'client_credentials',
        'client_id': SENDPULSE_CLIENT_ID,
        'client_secret': SENDPULSE_CLIENT_SECRET
    }).encode()

    req = urllib.request.Request(url, data=payload,
        headers={'Content-Type': 'application/json'})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            _token_data['token'] = result['access_token']
            _token_data['expires_at'] = now + result['expires_in']
            log.info('OAuth token refreshed (expires in %ds)', result['expires_in'])
            return _token_data['token']
    except Exception as e:
        log.error('Failed to get OAuth token: %s', e)
        return None


def send_via_sendpulse(from_addr: str, to_addrs: list[str], subject: str,
                       html_body: str, text_body: str):
    """Send an email via SendPulse REST API."""
    token = get_access_token()
    if not token:
        return False, 'Failed to get OAuth token'

    # Always use the verified sender and the CareNest brand display name.
    # This relay only ever serves CareNest mail (the From address is forced to
    # VERIFIED_SENDER regardless of what the upstream MTA put in the header),
    # so forcing the display name here too keeps Gmail showing "CareNest"
    # instead of the upstream default ("listmonk").
    from_email = VERIFIED_SENDER
    from_name = 'CareNest'

    # Prepare recipients
    recipients = []
    for addr in to_addrs:
        try:
            name, email_addr = email.utils.parseaddr(addr)
            recipients.append({
                'name': name or email_addr.split('@')[0],
                'email': email_addr
            })
        except:
            recipients.append({'name': addr, 'email': addr})

    email_data = {
        'email': {
            'subject': subject,
            'from': {
                'name': from_name,
                'email': from_email
            },
            'to': recipients,
            'html': base64.b64encode((html_body or text_body or '').encode('utf-8')).decode('utf-8'),
            'text': text_body or '',
        }
    }

    url = 'https://api.sendpulse.com/smtp/emails'
    payload = json.dumps(email_data).encode()
    req = urllib.request.Request(url, data=payload,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}'
        })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            log.info('Email sent to %s: id=%s', recipients[0]['email'],
                      result.get('id', 'N/A'))
            return True, f'Sent: {result.get("id", "ok")}'
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        log.error('SendPulse API error %s: %s', e.code, body)
        return False, f'SendPulse error {e.code}: {body}'
    except Exception as e:
        log.error('SendPulse API error: %s', e)
        return False, str(e)


def parse_email_data(raw_data: bytes) -> tuple:
    """Parse raw email data and extract subject, HTML, text bodies."""
    msg = email.message_from_bytes(raw_data)

    subject = msg.get('Subject', '(No subject)')
    from_addr = msg.get('From', '')
    
    to_addrs = []
    to_header = msg.get('To', '')
    if to_header:
        to_addrs = [a.strip() for a in to_header.split(',')]

    html_body = ''
    text_body = ''

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            charset = part.get_content_charset() or 'utf-8'
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                decoded = payload.decode(charset, errors='replace')
                if content_type == 'text/html':
                    html_body = decoded
                elif content_type == 'text/plain' and not text_body:
                    text_body = decoded
            except Exception:
                continue
    else:
        content_type = msg.get_content_type()
        charset = msg.get_content_charset() or 'utf-8'
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                decoded = payload.decode(charset, errors='replace')
                if content_type == 'text/html':
                    html_body = decoded
                else:
                    text_body = decoded
        except Exception:
            pass

    return from_addr, to_addrs, subject, html_body, text_body


class SendPulseRelayHandler:
    """SMTP handler that relays emails via SendPulse API."""

    async def handle_DATA(self, server, session, envelope):
        """Handle incoming email data."""
        peer = session.peer[0] if session.peer else 'unknown'
        mail_from = envelope.mail_from
        rcpt_tos = envelope.rcpt_tos
        data = envelope.content

        log.info('Received email from %s to %s (size=%db, peer=%s)',
                 mail_from, rcpt_tos, len(data), peer)

        try:
            from_addr, to_addrs, subject, html, text = parse_email_data(data)
            # If parsing didn't find any to/from, fall back to envelope values
            if not to_addrs and rcpt_tos:
                to_addrs = rcpt_tos
            if not from_addr:
                from_addr = mail_from

            log.info('Parsed: from=%s to=%s subject=%s', from_addr, to_addrs, subject)

            success, msg = send_via_sendpulse(from_addr, to_addrs, subject, html, text)

            if success:
                log.info('Successfully relayed: %s', msg)
                return '250 OK: ' + msg
            else:
                log.error('Failed to relay: %s', msg)
                return f'451 Requested action aborted: {msg[:200]}'

        except Exception as e:
            log.exception('Error processing email')
            return f'451 Requested action aborted: {e}'


def main():
    log.info('Starting SMTP-to-SendPulse relay on %s:%s', LISTEN_HOST, LISTEN_PORT)
    log.info('Verified sender: %s', VERIFIED_SENDER)
    
    if not SENDPULSE_CLIENT_ID or not SENDPULSE_CLIENT_SECRET:
        log.error('SENDPULSE_CLIENT_ID and SENDPULSE_CLIENT_SECRET must be set')
        return

    # Test token on startup
    token = get_access_token()
    if token:
        log.info('SendPulse OAuth: OK')
    else:
        log.error('SendPulse OAuth: FAILED - check credentials')
        return

    handler = SendPulseRelayHandler()
    controller = Controller(
        handler,
        hostname=LISTEN_HOST,
        port=LISTEN_PORT,
    )
    
    try:
        controller.start()
        log.info('SMTP relay is running. Press Ctrl+C to stop.')
        # Keep running
        asyncio.new_event_loop().run_forever()
    except KeyboardInterrupt:
        log.info('Shutting down...')
        controller.stop()
    except Exception as e:
        log.error('Failed to start: %s', e)


if __name__ == '__main__':
    main()
