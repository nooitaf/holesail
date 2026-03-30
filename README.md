# Holesail

```
 _   _       _                 _ _   _ 
| | | | ___ | | ___  ___  __ _(_) | (_) ___ 
| |_| |/ _ \| |/ _ \/ __|/ _` | | | | |/ _ \
|  _  | (_) | |  __/\__ \ (_| | | |_| | (_) |
|_| |_|\___/|_|\___||___/\__,_|_|_(_)_|\___/
```

[Join our Discord Support Server](https://discord.gg/TQVacE7Vnj) [Join our Reddit Community](https://www.reddit.com/r/holesail/)

To support the development of this project:

Lightning BTC: linenbird5@primal.net
BTC Address: 183Pfn4fxuMJMSvZXdBdYsNKWSnWHCdBdA

## Overview

Holesail is a truly peer-to-peer (P2P) network tunneling and reverse proxy software that supports both TCP and UDP protocols. 

Holesail lets you share any locally running application on a specific port with third parties securely and with a single command. No static IP or port forwarding required.

## Installation

Before using Holesail, make sure you have Node.js installed on your system. You can download Node.js from the official website: [https://nodejs.org/en/download/](https://nodejs.org/en/download/)

Once Node.js is installed, you can install Holesail using npm:

```bash
npm i holesail -g
```

## Usage

### 1. Share a Local Port (Server)

To share a local service (e.g., a web server running on port 3000):

```bash
holesail --live 3000
```

Holesail will provide a connection string (e.g., `hs://s000...`).

### 2. Connect to a Shared Port (Client)

To access a shared service from another machine:

```bash
holesail <connection-string>
```

By default, this will map the remote service to `127.0.0.1:8989`. You can then access it at `http://localhost:8989`.

### 3. P2P File Manager

Holesail includes a built-in P2P file manager that allows you to browse, download, upload, and manage files remotely over the P2P network.

```bash
holesail --filemanager ./my-folder
```

**Features:**
- **Secure Access:** Password protection (default: admin/admin).
- **Responsive UI:** Modern, dark-themed interface with a collapsible sidebar.
- **Folder Uploads:** Support for uploading entire directory structures.
- **File Management:** Create folders and delete items directly from the browser.
- **Multi-select:** Perform bulk downloads or deletions.

### 4. Key Lookup

Inspect a Holesail connection key to see its associated host, port, and protocol:

```bash
holesail --lookup <connection-string>
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--live <port>` | Start a Holesail server on the specified port. |
| `--connect <key>` | Connect to a Holesail server using its key. |
| `--filemanager <dir>` | Start a P2P file manager session in the specified directory. |
| `--lookup <key>` | Lookup details for a Holesail connection key. |
| `--host <host>` | Specify the host address (default: `127.0.0.1`). |
| `--port <port>` | Specify a custom local port for the client (default: `8989`). |
| `--udp` | Use UDP protocol instead of TCP. |
| `--public` | Start in public mode (insecure). |
| `--username <user>` | Set a custom username for the File Manager (default: `admin`). |
| `--password <pass>` | Set a custom password for the File Manager (default: `admin`). |
| `--log [level]` | Enable debug logs (0: DEBUG, 1: INFO, 2: WARN, 3: ERROR). |

## Docker Support

You can also run the Holesail File Manager using Docker:

```bash
docker-compose up -d --build
```

Access the File Manager at `http://localhost:8989`.

## API

### Usage

```js
const Holesail = require('holesail')

const hs = new Holesail({
  server: true, // act as a server
  secure: true // use secure mode
})

await hs.ready()
console.log('Server is ready:', hs.info.url)
```

## URL Format

Holesail uses a custom URL scheme:
- **Secure (Private):** `hs://s000<key>`
- **Insecure (Public):** `hs://0000<key>`

## Documentation

Full documentation is available at [https://docs.holesail.io/](https://docs.holesail.io/)

## License

This project is licensed under the GNU AGPL v3 license — see the [LICENSE](LICENSE) file.

## Acknowledgments

Holesail is built on and inspired by:
- [Holepunch](https://holepunch.to)
- [HyperDHT](https://github.com/holepunchto/hyperdht)
