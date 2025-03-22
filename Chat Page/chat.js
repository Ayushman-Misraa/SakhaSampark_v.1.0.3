// Initialize variables
let currentUser = null;
let currentPeer = null;
let activeConnection = null;
let activeContactPeerId = null;

// DOM Elements
const currentUsernameEl = document.getElementById('currentUsername');
const peerIdEl = document.getElementById('peerId');
const contactUsernameEl = document.getElementById('contactUsername');
const contactPeerIdEl = document.getElementById('contactPeerId');
const connectionStatusEl = document.getElementById('connectionStatus');
const chatMessagesEl = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const fileUpload = document.getElementById('fileUpload');
const backToContactsBtn = document.getElementById('backToContacts');
const logoutBtn = document.getElementById('logoutBtn');
const fileTransferProgress = document.getElementById('fileTransferProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const fileTransferTitle = document.getElementById('fileTransferTitle');

// Show loading screen when page loads
document.addEventListener('DOMContentLoaded', () => {
    if (window.Loader) {
        Loader.show();
    }

    // Check if user is logged in
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            // User is signed in
            currentUser = user;
            initializeApp();
        } else {
            // No user is signed in, redirect to login page
            window.location.href = '../Login page/login.html';
        }
    });
});

// Initialize the application
function initializeApp() {
    // Get the contact peer ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    activeContactPeerId = urlParams.get('peerId');
    const contactUsername = urlParams.get('username');

    if (!activeContactPeerId) {
        // If no peer ID is provided, redirect to contacts page
        window.location.href = '../Conncetions Page/connections.html';
        return;
    }

    // Update UI with contact info
    contactUsernameEl.textContent = contactUsername || 'Unknown Contact';
    contactPeerIdEl.textContent = `Peer ID: ${activeContactPeerId}`;
    updateConnectionStatus('connecting');

    // Get current user's username from Firebase
    const userRef = firebase.database().ref(`users/${currentUser.uid}`);
    userRef.once('value').then((snapshot) => {
        const userData = snapshot.val();
        if (userData && userData.username) {
            currentUsernameEl.textContent = userData.username;
            
            // Initialize PeerJS with the username as the peer ID
            initializePeer(userData.username);
        } else {
            // If username is not found, use UID as fallback
            currentUsernameEl.textContent = currentUser.uid;
            initializePeer(currentUser.uid);
        }
    }).catch((error) => {
        console.error("Error getting user data:", error);
        // Use UID as fallback
        currentUsernameEl.textContent = currentUser.uid;
        initializePeer(currentUser.uid);
    });

    // Set up event listeners
    setupEventListeners();

    // Hide loading screen
    if (window.Loader) {
        Loader.hide();
    }
}

// Initialize PeerJS
function initializePeer(username) {
    // Create a new Peer with the username as the ID and use a public STUN server
    currentPeer = new Peer(username, {
        debug: 2,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    // Update UI with peer ID
    peerIdEl.textContent = `Peer ID: ${username}`;

    // Handle peer events
    currentPeer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        // Connect to the contact
        connectToPeer(activeContactPeerId);
    });

    currentPeer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        handleConnection(conn);
    });

    currentPeer.on('error', (err) => {
        console.error('Peer error:', err);
        updateConnectionStatus('offline');

        // Show more specific error messages
        let errorMessage = 'Connection error';
        if (err.type === 'peer-unavailable') {
            errorMessage = 'The contact is offline or unavailable';
        } else if (err.type === 'network') {
            errorMessage = 'Network connection issue. Please check your internet connection';
        } else if (err.type === 'server-error') {
            errorMessage = 'PeerJS server error. Please try again later';
        } else if (err.type) {
            errorMessage = `Connection error: ${err.type}`;
        }

        showErrorMessage(errorMessage);

        // Try to reconnect after a delay
        setTimeout(() => {
            if (activeContactPeerId && (!activeConnection || !activeConnection.open)) {
                console.log('Attempting to reconnect...');
                connectToPeer(activeContactPeerId);
            }
        }, 5000);
    });
}

// Connect to a peer
function connectToPeer(peerId) {
    if (!currentPeer) {
        console.error('Cannot connect: PeerJS not initialized');
        showErrorMessage('Connection error: PeerJS not initialized');
        return;
    }

    // If already connected to this peer, don't reconnect
    if (activeConnection && activeConnection.peer === peerId && activeConnection.open) {
        console.log('Already connected to this peer');
        updateConnectionStatus('online');
        return;
    }

    console.log('Attempting to connect to peer:', peerId);
    updateConnectionStatus('connecting');

    try {
        // Connect to the peer with reliable mode and metadata
        const conn = currentPeer.connect(peerId, {
            reliable: true,
            metadata: {
                username: currentUsernameEl.textContent,
                type: 'chat-connection'
            }
        });

        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
            if (!activeConnection || !activeConnection.open) {
                console.warn('Connection attempt timed out');
                showErrorMessage('Connection timed out. The contact may be offline.');
                updateConnectionStatus('offline');
            }
        }, 15000); // 15 seconds timeout

        conn.on('open', () => {
            clearTimeout(connectionTimeout);
        });

        handleConnection(conn);
    } catch (error) {
        console.error('Error connecting to peer:', error);
        showErrorMessage(`Connection error: ${error.message}`);
        updateConnectionStatus('offline');
    }
}

// Handle a peer connection
function handleConnection(conn) {
    // Store the connection
    activeConnection = conn;
    
    conn.on('open', () => {
        console.log('Connection established with', conn.peer);
        updateConnectionStatus('online');
        enableChat();
        
        // Send a greeting message
        sendSystemMessage(`Connected to ${contactUsernameEl.textContent}`);
    });

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        console.log('Connection closed');
        updateConnectionStatus('offline');
        disableChat();
        sendSystemMessage('Connection closed');
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        updateConnectionStatus('offline');
        showErrorMessage(`Connection error: ${err}`);
    });
}

// Create typing indicator element
const typingIndicator = document.createElement('div');
typingIndicator.className = 'typing-indicator';
typingIndicator.innerHTML = `
    <div class="typing-bubble">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
    </div>
    <div class="typing-text">${contactUsernameEl.textContent} is typing...</div>
`;
typingIndicator.style.display = 'none';
chatMessagesEl.appendChild(typingIndicator);

// Add CSS for typing indicator
const typingStyle = document.createElement('style');
typingStyle.textContent = `
    .typing-indicator {
        padding: 10px;
        margin: 5px 0;
        display: flex;
        align-items: center;
        align-self: flex-start;
    }

    .typing-bubble {
        display: flex;
        align-items: center;
        background-color: rgba(0, 0, 0, 0.1);
        padding: 8px 12px;
        border-radius: 18px;
        margin-right: 8px;
    }

    .dot {
        height: 8px;
        width: 8px;
        border-radius: 50%;
        background-color: #666;
        margin: 0 2px;
        animation: typing-bubble 1.4s infinite ease-in-out;
    }

    .dot:nth-child(1) { animation-delay: 0s; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes typing-bubble {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-5px); }
    }

    .typing-text {
        font-size: 0.8rem;
        color: #666;
    }

    .drag-over {
        border: 2px dashed #4A2E6F;
        background-color: rgba(184, 166, 217, 0.1);
    }
`;
document.head.appendChild(typingStyle);

// Handle incoming data
function handleIncomingData(data) {
    console.log('Received data type:', data.type);

    if (data.type === 'message') {
        // Regular text message
        displayMessage(data.content, 'incoming', data.timestamp);
        // Hide typing indicator when message is received
        typingIndicator.style.display = 'none';
    } else if (data.type === 'file-info') {
        // File information before the actual file data
        console.log('Received file info:', data);
        displayFileInfo(data, 'incoming');
        // Hide typing indicator when file is received
        typingIndicator.style.display = 'none';
    } else if (data.type === 'file-data') {
        // File data chunks
        console.log('Received file chunk, size:', data.chunk.byteLength);
        receiveFileChunk(data);
    } else if (data.type === 'file-complete') {
        // File transfer complete
        console.log('File transfer complete:', data.fileId);
        completeFileReceive(data);
    } else if (data.type === 'typing') {
        // Typing indicator
        handleTypingIndicator(data.isTyping);
    } else if (data.type === 'read-receipt') {
        // Read receipt
        handleReadReceipt(data.messageId);
    } else if (data.type === 'ping') {
        // Ping message to check connection - respond with pong
        if (activeConnection && activeConnection.open) {
            activeConnection.send({
                type: 'pong',
                timestamp: Date.now()
            });
        }
    } else if (data.type === 'pong') {
        // Pong response - connection is confirmed active
        console.log('Received pong, connection is active');
    } else {
        console.warn('Unknown data type received:', data);
    }
}

// Handle typing indicator
function handleTypingIndicator(isTyping) {
    if (isTyping) {
        typingIndicator.style.display = 'flex';
        scrollToBottom();
    } else {
        typingIndicator.style.display = 'none';
    }
}

// Handle read receipt
function handleReadReceipt(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        const readReceipt = messageEl.querySelector('.read-receipt');
        if (readReceipt) {
            readReceipt.innerHTML = '✓✓';
            readReceipt.style.color = '#4A2E6F';
            readReceipt.title = 'Read';
        }
    }
}

// File transfer variables
let receivingFile = {
    inProgress: false,
    data: [],
    info: null,
    fileId: null,
    receivedSize: 0
};

// Start receiving a file
function receiveFileChunk(data) {
    if (!receivingFile.inProgress) {
        console.log('Starting new file reception:', data.fileInfo);
        receivingFile.inProgress = true;
        receivingFile.data = [];
        receivingFile.info = data.fileInfo;
        receivingFile.fileId = data.fileId;
        receivingFile.receivedSize = 0;

        // Show progress UI
        showFileTransferProgress('Receiving file...', 0);
    }

    try {
        // Add chunk to received data
        receivingFile.data.push(data.chunk);
        receivingFile.receivedSize += data.chunk.byteLength;

        // Update progress
        const progress = Math.floor((receivingFile.receivedSize / receivingFile.info.size) * 100);
        console.log(`File reception progress: ${progress}% (${receivingFile.receivedSize}/${receivingFile.info.size} bytes)`);
        updateFileTransferProgress(progress);
    } catch (error) {
        console.error('Error processing file chunk:', error);
        showErrorMessage('Error processing file chunk');
    }
}

// Complete file reception
function completeFileReceive(data) {
    console.log('Completing file reception for fileId:', data.fileId);

    if (!receivingFile.inProgress) {
        console.warn('No file reception in progress when complete signal received');
        return;
    }

    try {
        // Combine all chunks
        console.log(`Creating blob from ${receivingFile.data.length} chunks, total size: ${receivingFile.receivedSize} bytes`);
        const fileBlob = new Blob(receivingFile.data, { type: receivingFile.info.type });
        console.log('File blob created, size:', fileBlob.size);

        // Store the blob in a global variable to prevent garbage collection
        if (!window.receivedFiles) {
            window.receivedFiles = {};
        }
        window.receivedFiles[data.fileId] = {
            blob: fileBlob,
            name: receivingFile.info.name,
            type: receivingFile.info.type
        };

        // Update the file message with download link
        const fileMessageEl = document.getElementById(`file-${data.fileId}`);
        if (fileMessageEl) {
            console.log('Found file message element, enabling download button');
            const downloadBtn = fileMessageEl.querySelector('.download-btn');
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.onclick = function() {
                    // Get the stored file data
                    const fileData = window.receivedFiles[data.fileId];
                    if (!fileData) {
                        console.error('File data not found for ID:', data.fileId);
                        showErrorMessage('File data not found. Please try receiving the file again.');
                        return;
                    }

                    // Create download link
                    const url = URL.createObjectURL(fileData.blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileData.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    // Don't revoke URL if it's an image (we'll use it for preview)
                    if (!fileData.type.startsWith('image/')) {
                        URL.revokeObjectURL(url);
                    } else {
                        // Add image preview
                        addImagePreview(fileMessageEl, url, fileData.name);
                    }
                };

                // Add a success message
                sendSystemMessage(`File "${receivingFile.info.name}" received successfully`);
            } else {
                console.warn('Download button not found in file message element');
            }
        } else {
            console.warn(`File message element with ID file-${data.fileId} not found`);

            // If the element wasn't found, create a new file message
            displayFileInfo({
                fileId: data.fileId,
                name: receivingFile.info.name,
                size: receivingFile.info.size,
                type: receivingFile.info.type,
                timestamp: data.timestamp
            }, 'incoming');

            // Get the newly created element and set up the download button
            setTimeout(() => {
                const newFileMessageEl = document.getElementById(`file-${data.fileId}`);
                if (newFileMessageEl) {
                    const downloadBtn = newFileMessageEl.querySelector('.download-btn');
                    if (downloadBtn) {
                        downloadBtn.disabled = false;
                        downloadBtn.onclick = function() {
                            // Get the stored file data
                            const fileData = window.receivedFiles[data.fileId];
                            if (!fileData) {
                                console.error('File data not found for ID:', data.fileId);
                                showErrorMessage('File data not found. Please try receiving the file again.');
                                return;
                            }

                            // Create download link
                            const url = URL.createObjectURL(fileData.blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = fileData.name;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);

                            // Don't revoke URL if it's an image (we'll use it for preview)
                            if (!fileData.type.startsWith('image/')) {
                                URL.revokeObjectURL(url);
                            } else {
                                // Add image preview
                                addImagePreview(newFileMessageEl, url, fileData.name);
                            }
                        };
                    }
                }
            }, 100);
        }
    } catch (error) {
        console.error('Error completing file reception:', error);
        showErrorMessage(`Error completing file reception: ${error.message}`);
    } finally {
        // Reset receiving file state
        receivingFile = {
            inProgress: false,
            data: [],
            info: null,
            fileId: null,
            receivedSize: 0
        };

        // Hide progress UI
        hideFileTransferProgress();
    }
}

// Send a file
function sendFile(file) {
    if (!activeConnection || !activeConnection.open) {
        showErrorMessage('No active connection to send file');
        return;
    }

    console.log('Starting file send process for:', file.name, 'size:', file.size, 'type:', file.type);

    // Generate a unique file ID
    const fileId = Date.now().toString();

    // Display file in chat
    displayFileInfo({
        fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        _file: file  // Store the file object for local downloads
    }, 'outgoing');

    // Send file info to peer
    console.log('Sending file-info to peer');
    activeConnection.send({
        type: 'file-info',
        fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: Date.now()
    });

    // Show progress UI
    showFileTransferProgress('Sending file...', 0);

    // Add a small delay to ensure the file-info message is processed first
    setTimeout(() => {
        // Read file and send in chunks
        const chunkSize = 16384; // 16KB chunks
        const reader = new FileReader();
        let offset = 0;
        let chunkCount = 0;

        reader.onload = (e) => {
            if (!activeConnection.open) {
                hideFileTransferProgress();
                showErrorMessage('Connection closed while sending file');
                return;
            }

            try {
                // Send chunk
                console.log(`Sending chunk ${chunkCount++}, size: ${e.target.result.byteLength} bytes`);
                activeConnection.send({
                    type: 'file-data',
                    fileId,
                    fileInfo: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    },
                    chunk: e.target.result
                });

                // Update progress
                offset += e.target.result.byteLength;
                const progress = Math.floor((offset / file.size) * 100);
                updateFileTransferProgress(progress);

                // Continue with next chunk or complete
                if (offset < file.size) {
                    // Add a small delay between chunks to prevent overwhelming the connection
                    setTimeout(readNextChunk, 10);
                } else {
                    console.log('File sending complete, waiting before sending completion message');
                    // Add a small delay before sending completion message to ensure all chunks are processed
                    setTimeout(() => {
                        console.log('Sending file-complete message');
                        activeConnection.send({
                            type: 'file-complete',
                            fileId,
                            timestamp: Date.now()
                        });
                    }, 1000); // Wait 1 second before sending completion message

                    // Enable download button for sender too
                    const fileMessageEl = document.getElementById(`file-${fileId}`);
                    if (fileMessageEl) {
                        const downloadBtn = fileMessageEl.querySelector('.download-btn');
                        if (downloadBtn) {
                            downloadBtn.disabled = false;
                            downloadBtn.onclick = () => {
                                // Create download link
                                const url = URL.createObjectURL(file);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = file.name;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            };
                        }
                    }

                    // Add a success message
                    sendSystemMessage(`File "${file.name}" sent successfully`);

                    // Hide progress UI
                    hideFileTransferProgress();
                }
            } catch (error) {
                console.error('Error sending file chunk:', error);
                hideFileTransferProgress();
                showErrorMessage(`Error sending file: ${error.message}`);
            }
        };

        reader.onerror = (error) => {
            console.error('Error reading file:', error);
            hideFileTransferProgress();
            showErrorMessage('Error reading file');
        };

        function readNextChunk() {
            try {
                const slice = file.slice(offset, offset + chunkSize);
                reader.readAsArrayBuffer(slice);
            } catch (error) {
                console.error('Error reading file chunk:', error);
                hideFileTransferProgress();
                showErrorMessage(`Error reading file chunk: ${error.message}`);
            }
        }

        // Start reading
        readNextChunk();
    }, 500);
}

// Show file transfer progress UI
function showFileTransferProgress(title, progress) {
    fileTransferTitle.textContent = title;
    updateFileTransferProgress(progress);
    fileTransferProgress.style.display = 'flex';
}

// Update file transfer progress
function updateFileTransferProgress(progress) {
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}%`;
}

// Hide file transfer progress UI
function hideFileTransferProgress() {
    fileTransferProgress.style.display = 'none';
}

// Display a file message in the chat
function displayFileInfo(fileData, messageType) {
    console.log('Displaying file info in chat:', fileData);

    // Check if this file message already exists
    const existingEl = document.getElementById(`file-${fileData.fileId}`);
    if (existingEl) {
        console.log('File message already exists, not creating duplicate');
        return;
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message ${messageType}`;
    messageEl.id = `file-${fileData.fileId}`;

    const timestamp = fileData.timestamp ? new Date(fileData.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    // Format file size
    const formattedSize = formatFileSize(fileData.size);

    // Get appropriate file icon based on file type
    const fileIcon = getFileIcon(fileData.type, fileData.name);

    messageEl.innerHTML = `
        <div class="message-header">
            <span>${messageType === 'outgoing' ? 'You' : contactUsernameEl.textContent}</span>
            <span>${timestamp}</span>
        </div>
        <div class="message-content file-message">
            <div class="file-info">
                <div class="file-icon">${fileIcon}</div>
                <div class="file-details">
                    <p class="file-name">${fileData.name}</p>
                    <p class="file-size">${formattedSize}</p>
                </div>
                <button class="download-btn" ${messageType === 'outgoing' ? '' : 'disabled'}>
                    <span class="btn-icon">⬇️</span>
                    <span class="btn-text">Download</span>
                </button>
            </div>
        </div>
    `;

    chatMessagesEl.appendChild(messageEl);
    scrollToBottom();

    console.log(`File message created with ID: file-${fileData.fileId}`);

    // If it's an outgoing message, enable the download button immediately
    if (messageType === 'outgoing' && fileData._file) {
        // Store the file in the global storage for later access
        if (!window.receivedFiles) {
            window.receivedFiles = {};
        }
        window.receivedFiles[fileData.fileId] = {
            blob: fileData._file,
            name: fileData.name,
            type: fileData.type
        };

        const downloadBtn = messageEl.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.onclick = function() {
                // Get the stored file data
                const fileData = window.receivedFiles[this.closest('.message').id.replace('file-', '')];
                if (!fileData) {
                    console.error('File data not found');
                    showErrorMessage('File data not found. Please try again.');
                    return;
                }

                // Create a download link for the local file
                const url = URL.createObjectURL(fileData.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileData.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Don't revoke URL if it's an image (we'll use it for preview)
                if (!fileData.type.startsWith('image/')) {
                    URL.revokeObjectURL(url);
                } else {
                    // Add image preview
                    addImagePreview(this.closest('.message'), url, fileData.name);
                }
            };
        }
    }
}

// Get appropriate file icon based on file type
function getFileIcon(mimeType, fileName) {
    // Check file type by MIME type
    if (mimeType.startsWith('image/')) {
        return '🖼️';
    } else if (mimeType.startsWith('video/')) {
        return '🎬';
    } else if (mimeType.startsWith('audio/')) {
        return '🎵';
    } else if (mimeType === 'application/pdf') {
        return '📄';
    } else if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
        return '📝';
    } else if (mimeType.includes('excel') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
        return '📊';
    } else if (mimeType.includes('powerpoint') || fileName.endsWith('.ppt') || fileName.endsWith('.pptx')) {
        return '📽️';
    } else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') ||
               fileName.endsWith('.zip') || fileName.endsWith('.rar') || fileName.endsWith('.tar.gz')) {
        return '🗜️';
    } else if (mimeType.includes('text/') || fileName.endsWith('.txt')) {
        return '📝';
    } else if (fileName.endsWith('.json') || fileName.endsWith('.xml') || fileName.endsWith('.html') ||
               fileName.endsWith('.css') || fileName.endsWith('.js')) {
        return '📋';
    } else {
        return '📎';
    }
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    else return (bytes / 1073741824).toFixed(1) + ' GB';
}

// Add image preview to file message
function addImagePreview(messageEl, imageUrl, imageName) {
    // Check if preview already exists
    if (messageEl.querySelector('.image-preview')) {
        return;
    }

    const fileContent = messageEl.querySelector('.message-content');

    // Create preview container
    const previewContainer = document.createElement('div');
    previewContainer.className = 'image-preview';
    previewContainer.style.marginTop = '10px';
    previewContainer.style.maxWidth = '100%';
    previewContainer.style.position = 'relative';

    // Create image element
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = imageName;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '200px';
    img.style.borderRadius = '8px';
    img.style.cursor = 'pointer';

    // Add click event to open image in full size
    img.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '1000';
        overlay.style.cursor = 'zoom-out';

        const fullImg = document.createElement('img');
        fullImg.src = imageUrl;
        fullImg.style.maxWidth = '90%';
        fullImg.style.maxHeight = '90%';
        fullImg.style.objectFit = 'contain';

        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
    });

    previewContainer.appendChild(img);
    fileContent.appendChild(previewContainer);
}

// Send a text message
function sendMessage(message) {
    if (!activeConnection || !activeConnection.open) {
        showErrorMessage('No active connection to send message');
        return;
    }

    const timestamp = Date.now();
    const messageId = `msg_${timestamp}`;

    // Send message to peer
    activeConnection.send({
        type: 'message',
        messageId,
        content: message,
        timestamp
    });

    // Display message in chat
    displayMessage(message, 'outgoing', timestamp, messageId);

    // Clear input
    messageInput.value = '';
}

// Display a message in the chat
function displayMessage(message, messageType, timestamp, messageId = null) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${messageType}`;
    if (messageId) {
        messageEl.id = messageId;
    }

    const formattedTime = new Date(timestamp).toLocaleTimeString();

    // Add read receipt for outgoing messages
    const readReceipt = messageType === 'outgoing' ?
        `<div class="read-receipt" title="Sent">✓</div>` : '';

    messageEl.innerHTML = `
        <div class="message-header">
            <span>${messageType === 'outgoing' ? 'You' : contactUsernameEl.textContent}</span>
            <span>${formattedTime}</span>
        </div>
        <div class="message-content">
            ${message}
        </div>
        ${readReceipt}
    `;

    chatMessagesEl.appendChild(messageEl);
    scrollToBottom();

    // If this is an incoming message, send a read receipt
    if (messageType === 'incoming' && messageId && activeConnection && activeConnection.open) {
        activeConnection.send({
            type: 'read-receipt',
            messageId
        });
    }
}

// Display a system message
function sendSystemMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message system';
    messageEl.style.alignSelf = 'center';
    messageEl.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
    messageEl.style.color = '#666';
    messageEl.style.padding = '5px 10px';
    messageEl.style.borderRadius = '5px';
    messageEl.style.fontSize = '0.9rem';
    
    messageEl.innerHTML = `
        <div class="message-content">
            ${message}
        </div>
    `;
    
    chatMessagesEl.appendChild(messageEl);
    scrollToBottom();
}

// Show an error message
function showErrorMessage(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'message error';
    errorEl.style.alignSelf = 'center';
    errorEl.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
    errorEl.style.color = '#dc3545';
    errorEl.style.padding = '5px 10px';
    errorEl.style.borderRadius = '5px';
    errorEl.style.fontSize = '0.9rem';
    
    errorEl.innerHTML = `
        <div class="message-content">
            ⚠️ ${message}
        </div>
    `;
    
    chatMessagesEl.appendChild(errorEl);
    scrollToBottom();
}

// Scroll chat to bottom
function scrollToBottom() {
    // Add a small delay to ensure all content is rendered
    setTimeout(() => {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }, 50);
}

// Update connection status
function updateConnectionStatus(status) {
    connectionStatusEl.className = `connection-status ${status}`;
    
    switch (status) {
        case 'online':
            connectionStatusEl.textContent = 'Online';
            enableChat();
            break;
        case 'offline':
            connectionStatusEl.textContent = 'Offline';
            disableChat();
            break;
        case 'connecting':
            connectionStatusEl.textContent = 'Connecting...';
            disableChat();
            break;
    }
}

// Enable chat functionality
function enableChat() {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    fileUpload.disabled = false;
}

// Disable chat functionality
function disableChat() {
    messageInput.disabled = true;
    sendBtn.disabled = true;
    fileUpload.disabled = true;
}

// Set up event listeners
function setupEventListeners() {
    // Send message on form submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message) {
            sendMessage(message);
        }
    });

    // Handle typing indicator
    let typingTimeout;
    messageInput.addEventListener('input', () => {
        if (activeConnection && activeConnection.open) {
            // Send typing indicator
            activeConnection.send({
                type: 'typing',
                isTyping: true
            });

            // Clear previous timeout
            clearTimeout(typingTimeout);

            // Set timeout to send stopped typing after 2 seconds of inactivity
            typingTimeout = setTimeout(() => {
                if (activeConnection && activeConnection.open) {
                    activeConnection.send({
                        type: 'typing',
                        isTyping: false
                    });
                }
            }, 2000);
        }
    });

    // Handle file upload
    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            sendFile(file);
            // Reset file input
            fileUpload.value = '';
        }
    });

    // Back to contacts button
    backToContactsBtn.addEventListener('click', () => {
        window.location.href = '../Conncetions Page/connections.html';
    });

    // Logout button
    logoutBtn.addEventListener('click', () => {
        // Show loading screen before logout
        if (window.Loader) {
            Loader.show();
        }

        // Close peer connection if exists
        if (currentPeer) {
            currentPeer.destroy();
        }

        // Close active connection if exists
        if (activeConnection && activeConnection.open) {
            activeConnection.close();
        }

        // Clear any session storage data
        sessionStorage.clear();

        // Sign out from Firebase
        firebase.auth().signOut().then(() => {
            // Redirect to the main index page which will handle the redirection
            window.location.href = '../index.html';
        }).catch((error) => {
            console.error('Error signing out:', error);
            if (window.Loader) {
                Loader.hide();
            }
        });
    });

    // Add drag and drop file upload
    chatMessagesEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        chatMessagesEl.classList.add('drag-over');
    });

    chatMessagesEl.addEventListener('dragleave', () => {
        chatMessagesEl.classList.remove('drag-over');
    });

    chatMessagesEl.addEventListener('drop', (e) => {
        e.preventDefault();
        chatMessagesEl.classList.remove('drag-over');

        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            sendFile(file);
        }
    });
}

// Check connection status and reconnect if needed
function checkConnectionStatus() {
    console.log('Checking connection status...');

    if (!activeConnection || !activeConnection.open) {
        console.log('Connection is closed or not established, attempting to reconnect...');
        if (activeContactPeerId) {
            // Send a ping to check if the peer is reachable
            if (navigator.onLine) {
                console.log('Device is online, attempting to reconnect');
                connectToPeer(activeContactPeerId);
            } else {
                console.log('Device is offline, cannot reconnect');
                updateConnectionStatus('offline');
                showErrorMessage('You are offline. Please check your internet connection.');
            }
        }
    } else {
        console.log('Connection is open and active');

        // Send a small ping to verify the connection is truly active
        try {
            activeConnection.send({
                type: 'ping',
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error sending ping:', error);
            // Connection might be broken
            activeConnection.close();
            updateConnectionStatus('offline');
            // Try to reconnect
            setTimeout(() => {
                if (activeContactPeerId) {
                    connectToPeer(activeContactPeerId);
                }
            }, 1000);
        }
    }
}

// Handle online/offline events
window.addEventListener('online', () => {
    console.log('Device is now online');
    if (activeContactPeerId && (!activeConnection || !activeConnection.open)) {
        connectToPeer(activeContactPeerId);
    }
});

window.addEventListener('offline', () => {
    console.log('Device is now offline');
    updateConnectionStatus('offline');
    showErrorMessage('You are offline. Please check your internet connection.');
});

// Set up periodic connection check
setInterval(checkConnectionStatus, 15000); // Check every 15 seconds

// Clean up when leaving the page
window.addEventListener('beforeunload', () => {
    if (currentPeer) {
        currentPeer.destroy();
    }
});