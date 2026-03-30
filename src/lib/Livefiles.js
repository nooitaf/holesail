const http = require('http')
const fs = require('fs')
const path = require('path')
const qs = require('querystring')
const ReadyResource = require('ready-resource')
const { promisify } = require('util')

const { base64Logo } = require('./logo.js')

// Convert fs methods to promises
const stat = promisify(fs.stat)
const readdir = promisify(fs.readdir)
const mkdir = promisify(fs.mkdir)
const writeFile = promisify(fs.writeFile)
const access = promisify(fs.access)

class Livefiles extends ReadyResource {
  constructor (opts = {}) {
    super()
    if (opts.path && fs.existsSync(opts.path)) {
      this.path = opts.path
    } else {
      throw new Error('INCORRECT OR NO PATH SPECIFIED')
    }

    // Initialize logger following holesail pattern
    this.logger = opts.logger || { log: () => { } }

    // default role is user
    // user can view and download files but an admin can create and delete files
    this.role = opts.role === 'admin' ? 'admin' : 'user'

    this.username =
      opts.username && typeof opts.username !== 'boolean'
        ? opts.username
        : 'admin' // Basic auth username
    this.password =
      opts.password && typeof opts.password !== 'boolean'
        ? opts.password
        : 'admin' // Basic auth password

    this.port = opts.port && typeof opts.port !== 'boolean' ? opts.port : 5409

    this.host =
      opts.host && typeof opts.host !== 'boolean' ? opts.host : '127.0.0.1'

    // Memory management settings
    this.maxRequestSize = opts.maxRequestSize || 1024 * 1024 * 1024 // 1GB default
    this.streamBufferSize = opts.streamBufferSize || 64 * 1024 // 64KB chunks
  }

  async _open () {
    // initialise local http server
    this.server = http.createServer(this.handleRequest.bind(this))
    this.server.listen(this.port, this.host, err => {
      if (err) {
        this.logger.log({ type: 3, msg: `Failed to start server on port ${this.port}: ${err.message}` })
        process.exit(1)
      }
      this.logger.log({ type: 1, msg: `Livefiles server started on ${this.host}:${this.port}` })
    })
  }

  async _close () {
    if (this.server) {
      this.server.close()
      this.logger.log({ type: 1, msg: 'Livefiles server closed' })
    }
  }

  handleRequest (req, res) {
    let urlPath
    try {
      // Use URL constructor to properly parse path and query
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      urlPath = decodeURIComponent(parsedUrl.pathname)
    } catch (e) {
      // Fallback if URL parsing fails
      urlPath = decodeURIComponent(req.url.split('?')[0])
    }
    
    const fullPath = path.join(this.path, urlPath)

    // Basic authentication check
    if (!this.authenticate(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Filemanager"' })
      res.end('Authentication required.')
      return
    }

    if (req.method === 'GET') {
      this.handleGetRequest(fullPath, urlPath, res, req)
    } else if (req.method === 'POST') {
      this.handlePostRequest(req, res, urlPath)
    }
  }

  encodePath (rawPath) {
    return rawPath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/')
  }

  getIcon (name, isDirectory) {
    const hiddenIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
    const folderIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5c7cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
    const videoIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff5e57" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>'
    const imageIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
    const fileIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z"/><path d="M13 3v6h6"/></svg>'

    if (name.startsWith('.')) return hiddenIcon
    if (isDirectory) return folderIcon

    const ext = path.extname(name).toLowerCase()
    const images = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp']
    const videos = ['.mp4', '.webm', '.ogv', '.avi', '.mov', '.wmv', '.flv', '.mkv']

    if (images.includes(ext)) return imageIcon
    if (videos.includes(ext)) return videoIcon

    return fileIcon
  }

  authenticate (req) {
    const authHeader = req.headers.authorization
    if (authHeader) {
      const encodedCredentials = authHeader.split(' ')[1]
      const credentials = Buffer.from(encodedCredentials, 'base64').toString(
        'utf-8'
      )
      const [username, password] = credentials.split(':')
      return username === this.username && password === this.password
    }
    return false
  }

  async handleGetRequest (fullPath, urlPath, res, req) {
    try {
      const stats = await stat(fullPath)

      if (stats.isDirectory()) {
        await this.listDirectory(fullPath, urlPath, res)
      } else if (stats.isFile()) {
        this.serveFile(fullPath, req, res)
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File Not Found')
      } else {
        this.logger.log({ type: 3, msg: `Error handling GET request: ${err.message}` })
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    }
  }

  handlePostRequest (req, res, urlPath) {
    const contentType = req.headers['content-type'] || ''
    
    if (contentType.includes('multipart/form-data')) {
      return this.handleMultipartUpload(req, res, urlPath)
    }

    let body = ''
    let totalSize = 0

    // Memory protection: limit request size
    req.on('data', chunk => {
      totalSize += chunk.length

      // Prevent memory exhaustion from large requests
      if (totalSize > this.maxRequestSize) {
        res.writeHead(413, { 'Content-Type': 'text/plain' })
        res.end('Request entity too large')
        req.destroy()
        return
      }

      body += chunk.toString()
    })

    req.on('end', async () => {
      try {
        const formData = qs.parse(body)
        const itemType = formData.item_type
        const name = formData.name
        const directory = formData.directory

        // Basic validation
        if (
          !itemType ||
          !name ||
          typeof name !== 'string' ||
          !['folder', 'file', 'delete'].includes(itemType)
        ) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Bad Request: Missing or invalid form data.')
          return
        }

        // Check user type for folder creation
        if (itemType === 'folder' && this.role !== 'admin') {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden: Only admin users can create folders.')
          return
        }

        const targetDir = path.join(urlPath, directory || '.')
        const newFullPath = path.join(this.path, targetDir, name)

        if (itemType === 'folder') {
          await this.createFolder(newFullPath, res, urlPath)
        } else if (itemType === 'file') {
          await this.createFile(newFullPath, res, urlPath)
        } else if (itemType === 'delete') {
          await this.deleteItem(newFullPath, res, urlPath)
        }
      } catch (error) {
        this.logger.log({ type: 3, msg: `Error processing POST request: ${error.message}` })
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })

    req.on('error', (err) => {
      this.logger.log({ type: 3, msg: `Request error: ${err.message}` })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Request processing error')
      }
    })
  }

  handleMultipartUpload (req, res, urlPath) {
    if (this.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden: Only admin users can upload files.')
      return
    }

    const chunks = []
    let totalSize = 0

    req.on('data', chunk => {
      totalSize += chunk.length
      if (totalSize > this.maxRequestSize) {
        res.writeHead(413, { 'Content-Type': 'text/plain' })
        res.end('Request entity too large')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks)
        const contentType = req.headers['content-type']
        const boundary = contentType.split('boundary=')[1]
        
        const parts = this.parseMultipart(body, boundary)
        const directory = parts.find(p => p.name === 'directory')?.data.toString() || ''
        const files = parts.filter(p => p.filename)

        if (files.length === 0) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('No files uploaded')
          return
        }

        const targetDir = path.join(urlPath, directory || '.')

        for (const file of files) {
          const newFullPath = path.join(this.path, targetDir, file.filename)
          // Ensure subdirectories exist for the file
          await mkdir(path.dirname(newFullPath), { recursive: true })
          await writeFile(newFullPath, file.data)
          this.logger.log({ type: 1, msg: `Uploaded file: ${newFullPath}` })
        }

        res.writeHead(302, { Location: this.encodePath(urlPath) })
        res.end()
      } catch (error) {
        this.logger.log({ type: 3, msg: `Error processing upload: ${error.message}` })
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal Server Error')
        }
      }
    })
  }

  parseMultipart (body, boundary) {
    const parts = []
    const boundaryBuffer = Buffer.from('--' + boundary)
    const endBoundaryBuffer = Buffer.from('--' + boundary + '--')

    let start = body.indexOf(boundaryBuffer)

    while (start !== -1 && start < body.length) {
      // Check if we hit the end boundary
      if (body.slice(start, start + endBoundaryBuffer.length).equals(endBoundaryBuffer)) {
        break
      }

      // Find the next boundary to determine the end of this part
      const nextBoundary = body.indexOf(boundaryBuffer, start + boundaryBuffer.length)
      if (nextBoundary === -1) break

      // The actual part is between boundaries (excluding the \r\n before the next boundary)
      const part = body.slice(start + boundaryBuffer.length + 2, nextBoundary - 2)

      const headerEnd = part.indexOf('\r\n\r\n')
      if (headerEnd !== -1) {
        const header = part.slice(0, headerEnd).toString()
        const data = part.slice(headerEnd + 4)

        const nameMatch = header.match(/name="([^"]+)"/)
        const filenameMatch = header.match(/filename="([^"]+)"/)

        if (nameMatch || filenameMatch) {
          parts.push({
            name: nameMatch ? nameMatch[1] : null,
            filename: filenameMatch ? filenameMatch[1] : null,
            data
          })
        }
      }

      start = nextBoundary
    }
    return parts
  }
  async calculateDirectorySize (dirPath) {
    let totalSize = 0
    try {
      const items = await readdir(dirPath, { withFileTypes: true })

      // Process files in batches to avoid blocking event loop
      for (let i = 0; i < items.length; i += 10) {
        const batch = items.slice(i, i + 10)

        await Promise.all(batch.map(async (item) => {
          if (!item.isDirectory()) {
            try {
              const itemPath = path.join(dirPath, item.name)
              const stats = await stat(itemPath)
              totalSize += stats.size
            } catch (e) {
              // Skip files that can't be accessed
            }
          }
        }))

        // Yield control to event loop between batches
        if (i + 10 < items.length) {
          await new Promise(resolve => setImmediate(resolve))
        }
      }

      return totalSize
    } catch (e) {
      this.logger.log({ type: 2, msg: `Error calculating directory size: ${e.message}` })
      return 0
    }
  }

  async listDirectory (fullPath, urlPath, res) {
    try {
      const files = await readdir(fullPath, { withFileTypes: true })

      // Separate and sort directories and files
      const folders = files.filter(file => file.isDirectory())
      const normalFiles = files.filter(file => !file.isDirectory())
      const allFiles = [...folders, ...normalFiles]

      // Process files in batches to avoid blocking
      const directoryItems = []

      for (let i = 0; i < allFiles.length; i += 5) {
        const batch = allFiles.slice(i, i + 5)

      const batchResults = await Promise.all(batch.map(async (file) => {
          try {
            // Check if file is readable
            await access(path.join(fullPath, file.name), fs.constants.R_OK)

            const filePath = this.encodePath(path.join(urlPath, file.name)).replace(/\\/g, '/')
            const safeFileName = this.escapeHtml(file.name)
            const iconHtml = this.getIcon(file.name, file.isDirectory())

            const downloadButton = file.isDirectory()
              ? ''
              : `<a class="download--link" href="${filePath}" download title="Download">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </a>`

            let deleteButton = ''
            if (this.role === 'admin') {
              deleteButton = `
                <button class="delete--btn" onclick="deleteItem('${this.escapeHtml(file.name)}', '${file.isDirectory() ? 'folder' : 'file'}')">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>`
            }

            // Get file or folder size (optimized)
            let size
            if (file.isDirectory()) {
              // For directories, calculate size asynchronously
              const dirSize = await this.calculateDirectorySize(path.join(fullPath, file.name))
              size = this.formatBytes(dirSize)
            } else {
              const stats = await stat(path.join(fullPath, file.name))
              size = this.formatBytes(stats.size)
            }

            return `<tr data-name="${this.escapeHtml(file.name)}" data-type="${file.isDirectory() ? 'folder' : 'file'}" data-url="${filePath}">
              <td class="checkbox--cell">
                <input type="checkbox" class="item--checkbox" onchange="updateBulkActions()">
              </td>
              <td>
                <div class="file--name">
                  ${iconHtml}
                  <a href="${filePath}" target="_blank">${safeFileName}</a>
                </div>
              </td>
              <td class="size--cell">${size}</td>
              <td class="actions--cell">
                <div class="actions--group">
                  ${downloadButton}
                  ${deleteButton}
                </div>
              </td>
            </tr>`
          } catch {
            return null // Skip if not readable
          }
        }))

        directoryItems.push(...batchResults.filter(item => item !== null))

        // Yield control to event loop between batches
        if (i + 5 < allFiles.length) {
          await new Promise(resolve => setImmediate(resolve))
        }
      }

      const directoryList = directoryItems.join('')

      let controlsHtml = ''
      const bulkActionsHtml = `
    <div id="bulkActions" class="bulk--actions" style="display:none">
      <div class="bulk--actions--content">
        <span id="selectedCount">0 items selected</span>
        <div class="bulk--actions--btns">
          <button class="bulk--btn" onclick="downloadSelected()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
          </button>
          ${this.role === 'admin' ? `
          <button class="bulk--btn" onclick="deleteSelected()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Delete
          </button>` : ''}
          <button class="bulk--btn" onclick="deselectAll()">Cancel</button>
        </div>
      </div>
    </div>`

      if (this.role === 'admin') {
        controlsHtml = `
    <div class="toolbar">
      <div class="toolbar--left">
        <button class="btn btn--upload" onclick="showUploadModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Upload Files
        </button>
        <button class="btn btn--upload" onclick="showFolderUploadModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Upload Folder
        </button>
        <button class="btn btn--outline" onclick="createNewFolder()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
          New Folder
        </button>
      </div>
    </div>

    <!-- Hidden forms for actions -->
    <div id="uploadModal" class="modal">
      <div class="modal--content">
        <div class="modal--header">
          <h3>Upload Files</h3>
          <button class="close--btn" onclick="hideUploadModal()">&times;</button>
        </div>
        <form method="POST" action="${urlPath}" enctype="multipart/form-data" onsubmit="return confirmUpload(this)">
          <div class="form--group">
            <label for="files">Select one or more files to upload to <code>${this.escapeHtml(urlPath || '/')}</code></label>
            <input type="file" name="files" id="files" multiple required>
          </div>
          <input type="hidden" name="item_type" value="upload">
          <input type="hidden" name="directory" value=".">
          <div class="modal--footer">
            <button type="button" class="btn btn--light" onclick="hideUploadModal()">Cancel</button>
            <button type="submit" class="btn">Upload Now</button>
          </div>
        </form>
      </div>
    </div>

    <div id="folderUploadModal" class="modal">
      <div class="modal--content">
        <div class="modal--header">
          <h3>Upload Folder</h3>
          <button class="close--btn" onclick="hideFolderUploadModal()">&times;</button>
        </div>
        <form method="POST" action="${urlPath}" enctype="multipart/form-data" onsubmit="return confirmUpload(this)">
          <div class="form--group">
            <label for="folder">Select a folder to upload to <code>${this.escapeHtml(urlPath || '/')}</code></label>
            <input type="file" name="files" id="folder" webkitdirectory directory multiple required>
          </div>
          <input type="hidden" name="item_type" value="upload">
          <input type="hidden" name="directory" value=".">
          <div class="modal--footer">
            <button type="button" class="btn btn--light" onclick="hideFolderUploadModal()">Cancel</button>
            <button type="submit" class="btn">Upload Now</button>
          </div>
        </form>
      </div>
    </div>

    <form id="newFolderForm" method="POST" action="${urlPath}" style="display:none">
      <input type="hidden" name="item_type" value="folder">
      <input type="hidden" name="name" id="newFolderName">
      <input type="hidden" name="directory" value=".">
    </form>

    <form id="deleteForm" method="POST" action="${urlPath}" style="display:none">
      <input type="hidden" name="item_type" value="delete">
      <input type="hidden" name="name" id="deleteItemName">
      <input type="hidden" name="directory" value=".">
    </form>`
      }

      const pathSegments = urlPath.split('/').filter(p => p)
      let breadcrumbs = '<a href="/">Home</a>'
      let currentAcc = ''
      pathSegments.forEach((segment, i) => {
        currentAcc += '/' + segment
        breadcrumbs += ` <span class="sep">></span> <a href="${this.encodePath(currentAcc)}">${this.escapeHtml(segment)}</a>`
      })

      const htmlResponse = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Files - ${this.escapeHtml(urlPath)}</title>
                    <style>
                        :root {
                          --primary: #d63b3c;
                          --primary-hover: #d06b6c;
                          --danger: #ff5e57;
                          --bg: #0f172a;
                          --card-bg: #1e293b;
                          --text: #f1f5f9;
                          --text-light: #94a3b8;
                          --border: #334155;
                          --row-hover: #1e293b;
                          --header-bg: #1e293b;
                        }

                        * { box-sizing: border-box; }

                        body {
                          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                          background-color: var(--bg);
                          margin: 0;
                          padding: 0;
                          color: var(--text);
                          line-height: 1.5;
                          overflow-x: hidden;
                        }

                        .top--nav {
                          background: var(--card-bg);
                          height: 60px;
                          padding: 0 1.5rem;
                          display: flex;
                          align-items: center;
                          justify-content: space-between;
                          border-bottom: 1px solid var(--border);
                          position: sticky;
                          top: 0;
                          z-index: 1000;
                        }

                        .top--nav--left {
                          display: flex;
                          align-items: center;
                          gap: 1rem;
                        }

                        .menu--toggle {
                          background: none;
                          border: none;
                          color: var(--text);
                          cursor: pointer;
                          padding: 8px;
                          display: flex;
                          align-items: center;
                          border-radius: 8px;
                          transition: background 0.2s;
                        }

                        .menu--toggle:hover {
                          background: rgba(255,255,255,0.05);
                        }

                        .top--nav--path {
                          font-size: 0.9rem;
                          color: var(--text-light);
                          font-family: monospace;
                        }

                        .nav--meta {
                          font-size: 0.75rem;
                          font-weight: 700;
                          color: var(--text-light);
                          letter-spacing: 0.05em;
                        }

                        .nav--brand {
                          display: flex;
                          align-items: center;
                          gap: 12px;
                          text-decoration: none;
                          color: var(--text);
                          padding: 0.5rem 0;
                        }

                        .nav--brand img { width: 32px; height: auto; filter: brightness(1.2); }
                        .nav--brand span { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.5px; }

                        .app--layout {
                          display: flex;
                          position: relative;
                        }

                        .sidebar {
                          width: 260px;
                          background: var(--card-bg);
                          border-left: 1px solid var(--border);
                          padding: 1.5rem;
                          flex-shrink: 0;
                          position: fixed;
                          top: 60px;
                          right: 0;
                          height: calc(100vh - 60px);
                          overflow-y: auto;
                          z-index: 900;
                          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        }

                        .sidebar--header {
                          margin-bottom: 2rem;
                          border-bottom: 1px solid var(--border);
                          padding-bottom: 1rem;
                          text-align: center;
                        }

                        .sidebar--collapsed .sidebar {
                          transform: translateX(100%);
                        }

                        .main--content {
                          flex-grow: 1;
                          margin-right: 260px;
                          min-height: calc(100vh - 60px);
                          transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        }

                        .sidebar--collapsed .main--content {
                          margin-right: 0;
                        }

                        @media (max-width: 900px) {
                          .main--content {
                            margin-right: 0;
                          }
                          .sidebar {
                            transform: translateX(100%);
                            box-shadow: -20px 0 25px -5px rgba(0, 0, 0, 0.5);
                          }
                          .sidebar--open .sidebar {
                            transform: translateX(0);
                          }
                        }

                        .container {
                          max-width: 1200px;
                          margin: 0 auto;
                          padding: 2rem;
                        }

                        .breadcrumb {
                          margin-bottom: 2rem;
                          font-size: 1.25rem;
                          font-weight: 600;
                          color: var(--text-light);
                          display: flex;
                          align-items: center;
                          gap: 12px;
                          background: transparent;
                          padding: 0;
                          border-radius: 0;
                          border: none;
                        }

                        .breadcrumb a {
                          text-decoration: none;
                          color: var(--primary);
                          transition: opacity 0.2s;
                        }

                        .breadcrumb a:hover {
                          opacity: 0.8;
                          text-decoration: underline;
                        }

                        .breadcrumb .sep { 
                          color: var(--text-light); 
                          opacity: 0.5;
                          font-weight: 400;
                          font-size: 1rem;
                        }

                        .file--list--wrapper {
                          background: var(--card-bg);
                          border-radius: 12px;
                          border: 1px solid var(--border);
                          overflow: hidden;
                          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                        }

                        table {
                          width: 100%;
                          border-collapse: collapse;
                        }

                        th {
                          text-align: left;
                          padding: 1rem;
                          font-size: 0.75rem;
                          text-transform: uppercase;
                          letter-spacing: 0.05em;
                          color: var(--text-light);
                          border-bottom: 1px solid var(--border);
                          background: rgba(0,0,0,0.2);
                        }

                        td {
                          padding: 0.75rem 1rem;
                          border-bottom: 1px solid var(--border);
                          vertical-align: middle;
                        }

                        tr:last-child td { border-bottom: none; }

                        tr:hover { background-color: rgba(255,255,255,0.02); }

                        .file--name {
                          display: flex;
                          align-items: center;
                          gap: 12px;
                        }

                        .file--name a {
                          text-decoration: none;
                          color: var(--text);
                          font-weight: 500;
                          font-size: 0.95rem;
                        }

                        .file--name a:hover { color: var(--primary); }

                        .file--name svg { flex-shrink: 0; }

                        .actions--cell { width: 80px; text-align: right; }

                        .size--cell {
                          width: 120px;
                          color: var(--text-light);
                          font-size: 0.85rem;
                        }

                        .actions--group {
                          display: flex;
                          gap: 1rem;
                          justify-content: flex-end;
                          align-items: center;
                        }

                        .download--link {
                          color: var(--text-light);
                          display: flex;
                          align-items: center;
                          transition: color 0.2s;
                          text-decoration: none;
                        }

                        .download--link:hover {
                          color: var(--primary);
                        }

                        .delete--btn {
                          background: none;
                          border: none;
                          padding: 0;
                          color: var(--text-light);
                          cursor: pointer;
                          display: flex;
                          align-items: center;
                          transition: color 0.2s;
                        }

                        .delete--btn:hover {
                          color: var(--danger);
                        }

                        .bulk--actions {
                          position: fixed;
                          bottom: 0;
                          left: 0;
                          right: 0;
                          background: #0f172a;
                          color: white;
                          padding: 0.5rem 1rem;
                          border-top: 2px solid var(--primary);
                          z-index: 1001;
                        }

                        .bulk--actions--content {
                          max-width: 1200px;
                          margin: 0 auto;
                          display: flex;
                          align-items: center;
                          justify-content: space-between;
                        }

                        #selectedCount {
                          font-weight: 600;
                          font-size: 0.85rem;
                          color: var(--text-light);
                        }

                        .bulk--actions--btns {
                          display: flex;
                          gap: 0.5rem;
                        }

                        .bulk--btn {
                          background: var(--primary);
                          color: white;
                          border: none;
                          padding: 4px 12px;
                          border-radius: 4px;
                          font-size: 0.75rem;
                          font-weight: 600;
                          cursor: pointer;
                          display: flex;
                          align-items: center;
                          gap: 6px;
                          transition: filter 0.2s;
                        }

                        .bulk--btn:hover {
                          filter: brightness(1.1);
                        }

                        .checkbox--cell {
                          width: 30px;
                          padding-right: 0;
                        }

                        input[type="checkbox"] {
                          appearance: none;
                          -webkit-appearance: none;
                          width: 16px !important;
                          height: 16px !important;
                          min-width: 16px;
                          min-height: 16px;
                          border: 2px solid var(--border);
                          border-radius: 4px;
                          background: transparent;
                          display: inline-flex;
                          align-items: center;
                          justify-content: center;
                          position: relative;
                          cursor: pointer;
                          margin: 0;
                          padding: 0;
                          transition: all 0.2s;
                          box-sizing: border-box;
                        }

                        input[type="checkbox"]:checked {
                          background: var(--primary);
                          border-color: var(--primary);
                        }

                        input[type="checkbox"]:checked::after {
                          content: '';
                          width: 4px;
                          height: 8px;
                          border: solid white;
                          border-width: 0 2px 2px 0;
                          transform: rotate(45deg);
                          margin-bottom: 2px;
                        }

                        .toolbar {
                          display: flex;
                          flex-direction: column;
                          gap: 0.5rem;
                        }

                        .toolbar--left {
                          display: flex;
                          flex-direction: column;
                          width: 100%;
                        }

                        .modal {
                          display: none;
                          position: fixed;
                          z-index: 1000;
                          left: 0;
                          top: 0;
                          width: 100%;
                          height: 100%;
                          background-color: rgba(0,0,0,0.7);
                          backdrop-filter: blur(4px);
                        }

                        .modal--content {
                          background-color: var(--card-bg);
                          margin: 10% auto;
                          padding: 2rem;
                          border: 1px solid var(--border);
                          width: 90%;
                          max-width: 500px;
                          border-radius: 16px;
                          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
                        }

                        .modal--header {
                          display: flex;
                          justify-content: space-between;
                          align-items: center;
                          margin-bottom: 1.5rem;
                        }

                        .modal--header h3 { margin: 0; font-size: 1.25rem; color: var(--text); }

                        .close--btn {
                          background: none;
                          border: none;
                          font-size: 1.5rem;
                          cursor: pointer;
                          color: var(--text-light);
                        }

                        .modal--footer {
                          display: flex;
                          justify-content: flex-end;
                          gap: 0.75rem;
                          margin-top: 2rem;
                        }

                        .btn--secondary {
                          background: #334155;
                          color: var(--text);
                          padding: 0.75rem 1rem;
                          font-size: 0.9rem;
                          font-weight: 600;
                          display: flex;
                          align-items: center;
                          gap: 10px;
                          width: 100%;
                          margin-bottom: 0.75rem;
                          border: 1px solid var(--border);
                          border-radius: 8px;
                          cursor: pointer;
                          transition: all 0.2s;
                        }

                        .btn--secondary:hover {
                          background: #475569;
                          border-color: #64748b;
                          transform: translateY(-1px);
                        }

                        .btn--upload {
                          background: var(--primary);
                          color: white;
                          padding: 0.75rem 1rem;
                          font-size: 0.9rem;
                          font-weight: 600;
                          display: flex;
                          align-items: center;
                          gap: 10px;
                          width: 100%;
                          margin-bottom: 0.75rem;
                          border: none;
                          border-radius: 8px;
                          cursor: pointer;
                          transition: all 0.2s;
                        }

                        .btn--upload:hover {
                          background: var(--primary-hover);
                          transform: translateY(-1px);
                        }

                        .btn--outline {
                          background: transparent;
                          color: var(--primary);
                          padding: 0.75rem 1rem;
                          font-size: 0.9rem;
                          font-weight: 600;
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          gap: 10px;
                          width: 100%;
                          margin-bottom: 0.75rem;
                          border: 2px solid var(--primary);
                          border-radius: 8px;
                          cursor: pointer;
                          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        }

                        .btn--outline:hover {
                          background: var(--primary);
                          color: white;
                          transform: translateY(-1px);
                          box-shadow: 0 4px 12px rgba(214, 59, 60, 0.2);
                        }

                        .btn--light {
                          background: #334155;
                          color: var(--text);
                          width: auto;
                          margin: 0;
                          border: 1px solid var(--border);
                        }
                        .btn--light:hover { background: #475569; }

                        .form--group {
                          margin-bottom: 1rem;
                          display: flex;
                          flex-direction: column;
                          gap: 10px;
                        }

                        .form--group label {
                          font-size: 0.9rem;
                          color: var(--text-light);
                        }

                        code {
                          background: #0f172a;
                          color: var(--primary);
                          padding: 2px 4px;
                          border-radius: 4px;
                          font-family: monospace;
                        }

                        input, select {
                          padding: 0.75rem 1rem;
                          border-radius: 8px;
                          border: 1px solid var(--border);
                          background-color: #0f172a;
                          color: var(--text);
                          font-size: 0.95rem;
                          outline: none;
                          width: 100%;
                          font-family: inherit;
                        }

                        input:focus, select:focus {
                          border-color: var(--primary);
                          box-shadow: 0 0 0 3px rgba(92, 124, 255, 0.2);
                        }

                        .btn {
                          background-color: var(--primary);
                          color: white;
                          border: none;
                          padding: 0.75rem 1.5rem;
                          border-radius: 8px;
                          font-weight: 600;
                          cursor: pointer;
                          font-size: 0.9rem;
                          transition: all 0.2s;
                        }

                        .btn:hover { 
                          background-color: var(--primary-hover);
                          transform: translateY(-1px);
                        }

                        @media (max-width: 600px) {
                          .container { padding: 1rem; }
                          nav { padding: 1rem; }
                          .size--cell { display: none; }
                          .toolbar { flex-direction: column; align-items: stretch; }
                        }
                    </style>
                </head>
                <body>
                <nav class="top--nav">
                  <div class="top--nav--left">
                    <a href="/" class="nav--brand">
                      <img src="${base64Logo}" alt="Logo">
                      <span>holesail</span>
                    </a>
                  </div>
                  <button class="menu--toggle" onclick="toggleSidebar()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                  </button>
                </nav>

                <div class="app--layout">
                  <main class="main--content">
                    <div class="container">
                      <div class="breadcrumb">
                        ${breadcrumbs}
                      </div>

                      ${bulkActionsHtml}

                      <div class="file--list--wrapper">
                        <table>
                            <thead>
                              <tr>
                                  <th style="width: 40px;">
                                    <input type="checkbox" id="selectAll" onchange="toggleSelectAll(this)">
                                  </th>
                                  <th>Name</th>
                                  <th class="size--cell">Size</th>
                                  <th class="actions--cell"></th>
                              </tr>
                            </thead>
                            <tbody>
                              ${directoryList}
                            </tbody>
                        </table>
                      </div>
                    </div>
                  </main>

                  <aside class="sidebar" id="sidebar">
                    <div class="sidebar--header">
                      <div class="nav--meta">
                        ${this.role.toUpperCase()} MODE
                      </div>
                    </div>
                    <div class="sidebar--content">
                      ${controlsHtml}
                    </div>
                  </aside>
                </div>

                <script>
                function toggleSidebar() {
                  const isMobile = window.innerWidth <= 900;
                  if (isMobile) {
                    document.body.classList.toggle('sidebar--open');
                  } else {
                    document.body.classList.toggle('sidebar--collapsed');
                  }
                }

                function createNewFolder() {
                  const name = prompt("Enter folder name:");
                  if (name && name.trim()) {
                    document.getElementById('newFolderName').value = name.trim();
                    document.getElementById('newFolderForm').submit();
                  }
                }

                function showUploadModal() {
                  document.getElementById('uploadModal').style.display = 'block';
                }

                function hideUploadModal() {
                  document.getElementById('uploadModal').style.display = 'none';
                }

                function showFolderUploadModal() {
                  document.getElementById('folderUploadModal').style.display = 'block';
                }

                function hideFolderUploadModal() {
                  document.getElementById('folderUploadModal').style.display = 'none';
                }

                function confirmUpload(form) {
                  const fileInput = form.querySelector('input[type="file"]');
                  const count = fileInput.files.length;
                  if (count > 10) {
                    return confirm(\`Are you sure you want to upload \${count} file(s)?\`);
                  }
                  return true;
                }

                function deleteItem(name, type) {
                  if (confirm(\`Are you sure you want to delete this \${type}? \${name}\`)) {
                    document.getElementById('deleteItemName').value = name;
                    document.getElementById('deleteForm').submit();
                  }
                }

                function toggleSelectAll(checkbox) {
                  const items = document.querySelectorAll('.item--checkbox');
                  items.forEach(item => item.checked = checkbox.checked);
                  updateBulkActions();
                }

                function deselectAll() {
                  const selectAll = document.getElementById('selectAll');
                  if (selectAll) selectAll.checked = false;
                  toggleSelectAll({ checked: false });
                }

                function updateBulkActions() {
                  const items = document.querySelectorAll('.item--checkbox:checked');
                  const bulkBar = document.getElementById('bulkActions');
                  const countLabel = document.getElementById('selectedCount');
                  
                  if (items.length > 0) {
                    bulkBar.style.display = 'block';
                    countLabel.textContent = \`\${items.length} item(s) selected\`;
                  } else {
                    bulkBar.style.display = 'none';
                  }
                }

                async function downloadSelected() {
                  const items = document.querySelectorAll('.item--checkbox:checked');
                  for (const item of items) {
                    const row = item.closest('tr');
                    const url = row.getAttribute('data-url');
                    const type = row.getAttribute('data-type');
                    
                    if (type === 'file') {
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = '';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      // Small delay to help browsers handle multiple downloads
                      await new Promise(r => setTimeout(r, 200));
                    }
                  }
                  deselectAll();
                }

                async function deleteSelected() {
                  const items = document.querySelectorAll('.item--checkbox:checked');
                  if (confirm(\`Are you sure you want to delete \${items.length} item(s)?\`)) {
                    for (const item of items) {
                      const row = item.closest('tr');
                      const name = row.getAttribute('data-name');
                      
                      const formData = new FormData();
                      formData.append('item_type', 'delete');
                      formData.append('name', name);
                      formData.append('directory', '.');
                      
                      try {
                        await fetch(window.location.pathname, {
                          method: 'POST',
                          body: new URLSearchParams(formData)
                        });
                      } catch (e) {
                        console.error('Failed to delete', name);
                      }
                    }
                    window.location.reload();
                  }
                }

                window.onclick = function(event) {
                  const uploadModal = document.getElementById('uploadModal');
                  const folderModal = document.getElementById('folderUploadModal');
                  if (event.target == uploadModal) {
                    hideUploadModal();
                  }
                  if (event.target == folderModal) {
                    hideFolderUploadModal();
                  }
                }
                </script>
                </body>
                </html>
            `
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(htmlResponse)
    } catch (err) {
      this.logger.log({ type: 3, msg: `Error listing directory: ${err.message}` })
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    }
  }

  formatBytes (bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  serveFile (fullPath, req, res) {
    const extension = path.extname(fullPath).toLowerCase()
    const contentType =
      this.getContentType(extension) || 'application/octet-stream'

    fs.stat(fullPath, (err, stats) => {
      if (err) {
        this.logger.log({ type: 3, msg: `Error reading file stats: ${err.message}` })
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Error reading file.')
        return
      }

      const fileSize = stats.size
      const range = req.headers.range

      if (range) {
        // Example: "bytes=1000-"
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

        // Handle invalid ranges
        if (start >= fileSize || end >= fileSize) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          })
          res.end()
          return
        }

        const chunkSize = end - start + 1
        const fileStream = fs.createReadStream(fullPath, {
          start,
          end,
          highWaterMark: this.streamBufferSize // Control memory usage
        })

        const fileName = path.basename(fullPath)
        const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A')
        // Sanitize for ASCII-only filename parameter
        const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"')

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`
        })

        fileStream.pipe(res)

        // Handle stream errors
        fileStream.on('error', (err) => {
          this.logger.log({ type: 3, msg: `File stream error: ${err.message}` })
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('Error reading file')
          }
        })
      } else {
        // Normal download with controlled buffer size
        const fileStream = fs.createReadStream(fullPath, {
          highWaterMark: this.streamBufferSize // Control memory usage
        })
        const fileName = path.basename(fullPath)
        const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A')
        // Sanitize for ASCII-only filename parameter
        const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"')

        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`
        })

        fileStream.pipe(res)

        // Handle stream errors
        fileStream.on('error', (err) => {
          this.logger.log({ type: 3, msg: `File stream error: ${err.message}` })
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('Error reading file')
          }
        })
      }
    })
  }

  async createFolder (newFullPath, res, urlPath) {
    try {
      await mkdir(newFullPath, { recursive: true })
      this.logger.log({ type: 1, msg: `Created folder: ${newFullPath}` })
      res.writeHead(302, { Location: this.encodePath(urlPath) })
      res.end()
    } catch (err) {
      this.logger.log({ type: 3, msg: `Error creating folder: ${err.message}` })
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error creating folder.')
    }
  }

  async createFile (newFullPath, res, urlPath) {
    try {
      await writeFile(newFullPath, '')
      this.logger.log({ type: 1, msg: `Created file: ${newFullPath}` })
      res.writeHead(302, { Location: this.encodePath(urlPath) })
      res.end()
    } catch (err) {
      this.logger.log({ type: 3, msg: `Error creating file: ${err.message}` })
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error creating file.')
    }
  }

  async deleteItem (fullPath, res, urlPath) {
    try {
      // Use fs.promises.rm for recursive deletion of folders and files
      await fs.promises.rm(fullPath, { recursive: true, force: true })
      this.logger.log({ type: 1, msg: `Deleted item: ${fullPath}` })
      res.writeHead(302, { Location: this.encodePath(urlPath) })
      res.end()
    } catch (err) {
      this.logger.log({ type: 3, msg: `Error deleting item: ${err.message}` })
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error deleting item.')
    }
  }

  getContentType (extension) {
    const mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.py': 'text/x-python',
      '.c': 'text/x-c',
      '.cpp': 'text/x-c++src',
      '.h': 'text/x-c',
      '.sh': 'text/x-shellscript',
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.mp3': 'audio/mpeg',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/x-gzip',
      '.bz2': 'application/x-bzip2',
      '.7z': 'application/x-7z-compressed',
      '.wav': 'audio/x-wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/x-flac',
      '.m4a': 'audio/x-m4a',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.exe': 'application/x-msdownload'
    }
    return mimeTypes[extension] || null
  }

  async getDirectoryOptions () {
    const basePath = this.path
    const traverseDirectory = async (dir, depth = 0) => {
      let options = ''
      try {
        const items = await readdir(dir, { withFileTypes: true })

        // Process directories in batches to avoid blocking
        for (let i = 0; i < items.length; i += 10) {
          const batch = items.slice(i, i + 10).filter(item => item.isDirectory())

          for (const item of batch) {
            const itemPath = path.join(dir, item.name)
            const displayPath = itemPath.replace(basePath, '')
            const indent = '&nbsp;'.repeat(depth * 4)
            options += `<option value="${displayPath}">${indent}${item.name}</option>`

            // Recursively traverse subdirectories (with depth limit)
            if (depth < 5) { // Prevent infinite recursion
              options += await traverseDirectory(itemPath, depth + 1)
            }
          }

          // Yield control between batches
          if (i + 10 < items.length) {
            await new Promise(resolve => setImmediate(resolve))
          }
        }
      } catch (e) {
        // Skip directories that can't be accessed
      }
      return options
    }

    return await traverseDirectory(basePath)
  }

  escapeHtml (unsafe = '') {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  get info () {
    return {
      type: 'filemanager',
      host: this.host,
      port: this.port,
      role: this.role,
      username: this.username,
      password: this.password,
      maxRequestSize: this.maxRequestSize,
      streamBufferSize: this.streamBufferSize
    }
  }
}

module.exports = Livefiles
