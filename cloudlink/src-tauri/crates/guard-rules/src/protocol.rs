//! Bounded local execution protocol. No approval operation is exposed here.

use std::io::{self, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::Value;

pub const VERSION: u64 = 1;
pub const MAX_FRAME: usize = 256 * 1024;
pub const IO_TIMEOUT: Duration = Duration::from_secs(2);

pub fn connect(endpoint: &str) -> io::Result<TcpStream> {
    let address: SocketAddr = endpoint.parse().map_err(|_| invalid())?;
    if address.ip() != IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) || address.port() == 0 {
        return Err(invalid());
    }
    let stream = TcpStream::connect_timeout(&address, IO_TIMEOUT)?;
    configure(&stream)?;
    Ok(stream)
}

/// Accepted Windows sockets can inherit nonblocking mode from the listener.
pub fn configure(stream: &TcpStream) -> io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    stream.set_nodelay(true)
}

pub fn read_frame(stream: &mut TcpStream) -> io::Result<Value> {
    configure(stream)?;
    let mut size = [0; 4];
    stream.read_exact(&mut size)?;
    let size = u32::from_be_bytes(size) as usize;
    if size == 0 || size > MAX_FRAME {
        return Err(invalid());
    }
    let mut bytes = vec![0; size];
    stream.read_exact(&mut bytes)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if !value.is_object() || value["version"].as_u64() != Some(VERSION) {
        return Err(invalid());
    }
    Ok(value)
}

pub fn write_frame(stream: &mut TcpStream, value: &Value) -> io::Result<()> {
    if !value.is_object() || value["version"].as_u64() != Some(VERSION) {
        return Err(invalid());
    }
    let bytes = serde_json::to_vec(value).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME {
        return Err(invalid());
    }
    configure(stream)?;
    stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
    stream.write_all(&bytes)?;
    stream.flush()
}

pub fn constant_time_eq(left: &str, right: &str) -> bool {
    let mut difference = left.len() ^ right.len();
    let length = left.len().max(right.len());
    for index in 0..length {
        difference |= usize::from(
            left.as_bytes().get(index).copied().unwrap_or(0) ^ right.as_bytes().get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "execution-protocol-invalid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::net::TcpListener;

    #[test]
    fn fragmented_frames_round_trip_and_are_bounded() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = listener.local_addr().unwrap().to_string();
        let producer = std::thread::spawn(move || {
            let mut stream = connect(&endpoint).unwrap();
            let bytes = serde_json::to_vec(&json!({"version":VERSION,"op":"submit","text":"含空格"})).unwrap();
            for byte in (bytes.len() as u32).to_be_bytes().into_iter().chain(bytes) {
                stream.write_all(&[byte]).unwrap();
            }
            read_frame(&mut stream).unwrap()
        });
        let (mut stream, _) = listener.accept().unwrap();
        let value = read_frame(&mut stream).unwrap();
        assert_eq!(value["text"], "含空格");
        write_frame(&mut stream, &json!({"version":VERSION,"state":"waiting"})).unwrap();
        assert_eq!(producer.join().unwrap()["state"], "waiting");
    }

    #[test]
    fn endpoints_are_loopback_only_and_tokens_compare_exactly() {
        for endpoint in ["0.0.0.0:8000", "192.0.2.1:8000", "localhost:8000", "127.0.0.1:0"] {
            assert!(connect(endpoint).is_err());
        }
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "ab"));
        assert!(!constant_time_eq("abc", "abd"));
    }
}
