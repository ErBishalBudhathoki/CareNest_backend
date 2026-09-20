/**
 * Temporal connectivity diagnostic.
 *
 * Exercises the exact connection path the API uses (TemporalManager) and
 * reports each layer: DNS → TCP → gRPC handshake → namespace → schedules.
 * Run from any host to distinguish "server down" from "this host blocked":
 *
 *   node scripts/temporal-ping.js
 *
 * Env honored: TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TLS,
 * TEMPORAL_TLS_CA/CERT/KEY, FIREBASE_PROJECT_ID, NODE_ENV.
 */
const dns = require('dns').promises;
const net = require('net');

async function tcpProbe(host, port, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = net.connect(Number(port), host);
    const done = (result) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done('OPEN'));
    socket.on('timeout', () => done('TIMEOUT'));
    socket.on('error', (err) => done(err.code || err.message));
  });
}

async function main() {
  const TemporalManager = require('../core/TemporalManager');
  const address =
    process.env.TEMPORAL_ADDRESS || 'temporal-direct.bishalbudhathoki.com:7236';
  const [host, port] = address.split(':');

  console.log(`target: ${address}`);
  console.log(`task queue for this env: ${TemporalManager.getTaskQueue()}`);

  try {
    const lookup = await dns.lookup(host, { family: 4 });
    console.log(`DNS IPv4: ${lookup.address}`);
    console.log(`TCP ${port}: ${await tcpProbe(lookup.address, port || '7236')}`);
  } catch (err) {
    console.log(`DNS/TCP failed: ${err.message}`);
  }

  try {
    const client = await TemporalManager.getClient();
    console.log('gRPC handshake: OK');
    const namespace =
      process.env.TEMPORAL_NAMESPACE || 'default';
    const desc =
      await client.connection.workflowService.describeNamespace({
        namespace,
      });
    console.log(
      `namespace: ${(desc.namespaceInfo && desc.namespaceInfo.name) || namespace}`,
    );
    try {
      const res =
        await client.connection.workflowService.listSchedules({ namespace });
      console.log(
        `schedules: ${JSON.stringify((res.schedules || []).map((s) => s.scheduleId))}`,
      );
    } catch (err) {
      console.log(`listSchedules failed: ${err.message}`);
    }
    await TemporalManager.close();
  } catch (err) {
    console.log(`gRPC/namespace FAILED: ${(err.details || err.message || '').slice(0, 200)}`);
    console.log(
      'Likely causes: host IP-allowlisted (worker host only), server down, ' +
        'or missing mTLS client certs (TEMPORAL_TLS_CERT/KEY). ' +
        'Check worker container logs + Temporal UI from the VPS.',
    );
    process.exitCode = 1;
  }
}

main();
