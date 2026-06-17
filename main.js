document.addEventListener('DOMContentLoaded', () => {
  // --- STATE VARIABLES ---
  let isHost = true;
  let myPeerId = null;
  let hostPeerId = null;
  
  let peer = null;
  let hostConnection = null; // Used by student to connect to host
  let activeConnections = {}; // Used by host to track student data channels (peerId -> connection)
  let activeCalls = {}; // Track active MediaCalls (peerId -> call)
  let students = {}; // Host state: track student names (peerId -> { name })
  
  let localScreenStream = null; // Host screen stream
  
  let myDisplayName = 'Imarticus Admin';
  
  // --- DOM SELECTORS ---
  const appContainer = document.getElementById('app-container');
  const globalStatusDot = document.getElementById('global-status-dot');
  const globalStatusText = document.getElementById('global-status-text');
  
  // Views
  const broadcasterVideoContainer = document.getElementById('broadcaster-video-container');
  const viewerVideoContainer = document.getElementById('viewer-video-container');
  
  // Media Elements
  const localVideo = document.getElementById('local-video');
  const remoteVideo = document.getElementById('remote-video');
  
  // Buttons & Controls
  const startBtn = document.getElementById('start-btn');
  const screenToggleBtn = document.getElementById('screen-toggle-btn');
  const inviteBtn = document.getElementById('invite-btn');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const leaveBtn = document.getElementById('leave-btn');
  
  // Sidebar elements
  const workspaceSidebar = document.getElementById('workspace-sidebar');
  const myNameBadge = document.getElementById('my-name-badge');
  const inviteWidget = document.getElementById('invite-widget');
  const shareLinkInput = document.getElementById('share-link-input');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const participantCount = document.getElementById('participant-count');
  const participantList = document.getElementById('participant-list');
  const chatMessages = document.getElementById('chat-messages');
  const chatInputForm = document.getElementById('chat-input-form');
  const chatMessageInput = document.getElementById('chat-message-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  
  // Overlay/Modal Elements
  const welcomeOverlay = document.getElementById('welcome-modal-overlay');
  const studentNameInput = document.getElementById('student-name-input');
  const joinBtn = document.getElementById('join-btn');



  // --- INITIALIZATION ---
  const urlParams = new URLSearchParams(window.location.search);
  const watchId = urlParams.get('watch');

  if (watchId) {
    // Viewer Mode (Student)
    isHost = false;
    hostPeerId = watchId;
    myDisplayName = 'Student';
    initViewerMode();
  } else {
    // Broadcaster Mode (Guide)
    isHost = true;
    myDisplayName = 'Imarticus Admin';
    initBroadcasterMode();
  }

  // --- BROADCASTER (GUIDE) LOGIC ---
  function initBroadcasterMode() {
    broadcasterVideoContainer.classList.add('active');
    viewerVideoContainer.classList.add('hidden');
    inviteWidget.classList.remove('hidden');
    
    // Guide specific button configuration
    screenToggleBtn.classList.add('hidden'); // hidden until sharing starts
    
    updateGlobalStatus('Initializing connection...', 'waiting');
    
    // Create Host Peer
    peer = new Peer();
    
    peer.on('open', (id) => {
      myPeerId = id;
      const shareUrl = `${window.location.origin}${window.location.pathname}?watch=${id}`;
      shareLinkInput.value = shareUrl;

      updateGlobalStatus('Ready. Invite student to start', 'waiting');
      myNameBadge.textContent = 'Imarticus Admin (Host)';
      
      // Now enable chat input since guide is ready
      enableChatInput();
    });

    peer.on('connection', (conn) => {
      console.log('Incoming student data connection:', conn.peer);
      setupHostDataHandlers(conn);
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      addSystemMessage(`Connection error: ${err.message}`);
    });

    // Share Screen trigger
    startBtn.addEventListener('click', startScreenShare);
    screenToggleBtn.addEventListener('click', stopScreenShare);
  }

  async function startScreenShare() {
    try {
      updateGlobalStatus('Requesting screen media...', 'waiting');
      
      // Capture Screen Video (and system audio, if user checks the option)
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });

      // Play locally in video element (muted to avoid feedback/loops)
      localVideo.srcObject = localScreenStream;
      document.getElementById('preview-overlay').classList.add('hidden');

      // Update control elements
      screenToggleBtn.classList.remove('hidden');
      screenToggleBtn.classList.add('active-screen');
      
      // Broadcast screen share state change to all active students
      broadcastToAll({ type: 'state-change', isSharing: true });
      updateGlobalStatus('Sharing screen live', 'connected');
      addSystemMessage('Screen sharing started.');

      // Call all currently connected students to deliver the stream
      Object.keys(activeConnections).forEach(peerId => {
        callStudent(peerId);
      });

      // Handle native browser "Stop Sharing" button click
      localScreenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

    } catch (err) {
      console.error('Error starting screen share:', err);
      updateGlobalStatus('Ready. Invite student to start', 'waiting');
      alert('Could not start screen sharing. Ensure permissions are granted.');
    }
  }

  function stopScreenShare() {
    addSystemMessage('Screen sharing stopped.');
    
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(t => t.stop());
      localScreenStream = null;
    }
    localVideo.srcObject = null;
    
    document.getElementById('preview-overlay').classList.remove('hidden');
    screenToggleBtn.classList.add('hidden');
    screenToggleBtn.classList.remove('active-screen');

    // Close all active call connections
    Object.values(activeCalls).forEach(call => call.close());
    activeCalls = {};

    broadcastToAll({ type: 'state-change', isSharing: false });
    updateGlobalStatus('Screen share ended. Waiting...', 'waiting');
  }

  function callStudent(studentPeerId) {
    console.log('Initiating media call to student:', studentPeerId);
    
    // We send our screen stream to the student
    const call = peer.call(studentPeerId, localScreenStream || new MediaStream());
    activeCalls[studentPeerId] = call;

    call.on('close', () => {
      console.log('Student call closed:', studentPeerId);
      delete activeCalls[studentPeerId];
    });

    call.on('error', (err) => {
      console.error('Call connection error:', err);
    });
  }

  function setupHostDataHandlers(conn) {
    activeConnections[conn.peer] = conn;

    conn.on('data', (data) => {
      console.log('Received from student:', conn.peer, data);
      
      if (data.type === 'join') {
        students[conn.peer] = {
          name: data.name || 'Student'
        };

        addSystemMessage(`👋 ${students[conn.peer].name} joined the session`);
        
        // Broadcast arrival message to other participants
        broadcastToAll({
          type: 'chat',
          name: 'System',
          text: `👋 ${students[conn.peer].name} joined the session`
        });

        // Sync participant list with everyone
        updateAndBroadcastParticipants();

        // If Guide is already screen sharing, call the student immediately
        if (localScreenStream) {
          callStudent(conn.peer);
        }
      } 
      else if (data.type === 'chat') {
        const senderName = students[conn.peer]?.name || 'Student';
        addChatMessage(senderName, data.text, false);
        
        // Broadcast chat to all other students
        broadcastToAll({
          type: 'chat',
          name: senderName,
          text: data.text
        });
      }
    });

    conn.on('close', () => {
      console.log('Student data channel disconnected:', conn.peer);
      handleStudentDisconnect(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('Data channel error:', conn.peer, err);
      handleStudentDisconnect(conn.peer);
    });
  }

  function handleStudentDisconnect(peerId) {
    if (students[peerId]) {
      const name = students[peerId].name;
      addSystemMessage(`💨 ${name} left the session`);
      
      delete students[peerId];
      delete activeConnections[peerId];
      
      if (activeCalls[peerId]) {
        activeCalls[peerId].close();
        delete activeCalls[peerId];
      }

      // Notify remaining students
      broadcastToAll({
        type: 'chat',
        name: 'System',
        text: `💨 ${name} left the session`
      });
      updateAndBroadcastParticipants();
    }
  }

  function updateAndBroadcastParticipants() {
    const roster = [
      { id: myPeerId, name: 'Imarticus Admin (You)', isHost: true }
    ];
    
    Object.keys(students).forEach(id => {
      roster.push({
        id: id,
        name: students[id].name,
        isHost: false
      });
    });

    renderParticipants(roster);
    broadcastToAll({ type: 'participants', list: roster });
  }


  function initViewerMode() {
    broadcasterVideoContainer.classList.add('hidden');
    broadcasterVideoContainer.classList.remove('active');
    viewerVideoContainer.classList.remove('hidden');
    viewerVideoContainer.classList.add('active');
    inviteWidget.classList.add('hidden'); // students don't need to copy invite link
    
    // Show student welcome screen
    welcomeOverlay.classList.remove('hidden');

    joinBtn.addEventListener('click', joinSession);
  }

  function joinSession() {
    myDisplayName = studentNameInput.value.trim() || 'Student';
    myNameBadge.textContent = myDisplayName;
    
    // Unlock iOS Safari WebRTC Autoplay on user gesture
    remoteVideo.play().then(() => {
      remoteVideo.pause();
    }).catch(e => {
      console.log("iOS Video unlocked via user gesture");
    });
    
    // Hide Modal Overlay
    welcomeOverlay.classList.add('hidden');
    updateGlobalStatus('Connecting to signaling server...', 'waiting');
    addSystemMessage('Step 1: Connecting to signaling server...');

    // Create Student Peer
    peer = new Peer();

    peer.on('open', (id) => {
      myPeerId = id;
      updateGlobalStatus('Signaling connected. Connecting to Guide...', 'waiting');
      addSystemMessage('Step 2: Connected to signaling. Initiating connection to Guide ID: ' + hostPeerId);
      
      // Connect to the Guide's Peer ID (hostPeerId) for data/signaling
      const conn = peer.connect(hostPeerId);
      hostConnection = conn;
      setupStudentDataHandlers(conn);
    });

    // Handle the Guide's call (Guide calls us when they start sharing screen)
    peer.on('call', (call) => {
      console.log('Incoming call from Guide:', call.peer);
      activeCalls[call.peer] = call;

      // Student answers without sharing any local stream
      call.answer();

      call.on('stream', (remoteStream) => {
        console.log('Received screen share stream from Guide');
        remoteVideo.srcObject = remoteStream;
        
        // Explicitly play the video
        remoteVideo.play().catch(e => console.warn("Video play interrupted:", e));
        
        document.getElementById('viewer-overlay').classList.add('hidden');
        updateGlobalStatus('Connected: Watching screen', 'connected');
      });

      call.on('close', () => {
        remoteVideo.srcObject = null;
        document.getElementById('viewer-overlay').classList.remove('hidden');
        updateGlobalStatus('Guide stopped sharing.', 'waiting');
        delete activeCalls[call.peer];
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      updateGlobalStatus('Error: ' + err.type, 'waiting');
      addSystemMessage('❌ Connection error: ' + err.type + ' (' + err.message + ')');
      
      // Delay redirection on peer-unavailable so they can see the error
      if (err.type === 'peer-unavailable') {
        addSystemMessage('Session not found. Redirecting to Imarticus in 5 seconds...');
        setTimeout(() => {
          window.location.href = "https://imarticus.org";
        }, 5000);
      }
    });
  }

  function setupStudentDataHandlers(conn) {
    activeConnections[conn.peer] = conn;

    conn.on('open', () => {
      console.log('Data connection to Guide established.');
      updateGlobalStatus('Connected to Guide', 'connected');
      addSystemMessage('Step 3: Connection established! Syncing screen...');
      enableChatInput();

      // Send join message with name
      conn.send({
        type: 'join',
        name: myDisplayName
      });
    });

    conn.on('data', (data) => {
      console.log('Received from Guide:', data);

      if (data.type === 'chat') {
        if (data.name === 'System') {
          addSystemMessage(data.text);
        } else {
          addChatMessage(data.name, data.text, data.name === myDisplayName);
        }
      } 
      else if (data.type === 'participants') {
        renderParticipants(data.list);
      } 
      else if (data.type === 'state-change') {
        if (data.isSharing) {
          document.getElementById('viewer-overlay').classList.add('hidden');
          updateGlobalStatus('Guide is sharing screen', 'connected');
        } else {
          document.getElementById('viewer-overlay').classList.remove('hidden');
          remoteVideo.srcObject = null;
          updateGlobalStatus('Guide stopped sharing', 'waiting');
        }
      }
    });

    conn.on('close', () => {
      console.log('Disconnected from Guide. Redirecting...');
      window.location.href = "https://imarticus.org";
    });
  }


  // --- SHARED UTILITY FUNCTIONS ---

  function updateGlobalStatus(text, dotClass) {
    globalStatusText.textContent = text;
    globalStatusDot.className = 'pulse-indicator ' + dotClass;
  }

  function broadcastToAll(message) {
    Object.values(activeConnections).forEach(conn => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  // Rendering Participants roster
  function renderParticipants(list) {
    participantCount.textContent = list.length;
    participantList.innerHTML = '';

    list.forEach(p => {
      const item = document.createElement('div');
      item.className = 'participant-item';
      if (p.id === myPeerId) {
        item.style.borderLeft = '3px solid var(--primary)';
      }

      // Initial for Avatar
      const initial = p.name ? p.name.charAt(0).toUpperCase() : 'P';
      const roleStr = p.isHost ? 'Guide' : 'Student';

      item.innerHTML = `
        <div class="avatar">${initial}</div>
        <div class="details">
          <span class="name">${p.name} ${p.id === myPeerId ? '(You)' : ''}</span>
          <span class="role">${roleStr}</span>
        </div>
      `;
      participantList.appendChild(item);
    });
  }

  // Live Chat Handling
  chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatMessageInput.value.trim();
    if (!text) return;

    // Display self message locally
    addChatMessage(myDisplayName, text, true);

    if (isHost) {
      // Broadcast to all connected students
      broadcastToAll({
        type: 'chat',
        name: myDisplayName,
        text: text
      });
    } else {
      // Send message to host
      if (hostConnection && hostConnection.open) {
        hostConnection.send({
          type: 'chat',
          text: text
        });
      }
    }

    chatMessageInput.value = '';
    chatMessageInput.focus();
  });

  function enableChatInput() {
    chatMessageInput.removeAttribute('disabled');
    chatSendBtn.removeAttribute('disabled');
  }

  function disableChatInput() {
    chatMessageInput.setAttribute('disabled', 'true');
    chatSendBtn.setAttribute('disabled', 'true');
  }

  function addChatMessage(name, text, isSelf) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : ''}`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    bubble.innerHTML = `
      <div class="meta">${name} • ${timeStr}</div>
      <div class="body">${formatChatText(text)}</div>
    `;

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addSystemMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'system-message';
    msg.textContent = text;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatChatText(text) {
    // Basic HTML escaping
    const div = document.createElement('div');
    div.innerText = text;
    const escaped = div.innerHTML;
    
    // Regexp for URL matching
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlRegex, function(url) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--primary-hover); text-decoration: underline;">${url}</a>`;
    });
  }

  // --- BUTTON/UI EVENT HANDLERS ---

  // Invite button click: Toggle showing the invite links card
  inviteBtn.addEventListener('click', () => {
    inviteWidget.classList.toggle('hidden');
  });

  // Copy invite link button
  copyLinkBtn.addEventListener('click', () => {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      const originalIcon = copyLinkBtn.innerHTML;
      copyLinkBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${varSuccess()}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 5 12"/>
        </svg>
      `;
      setTimeout(() => {
        copyLinkBtn.innerHTML = originalIcon;
      }, 2000);
    });
  });

  function varSuccess() {
    return '#10b981'; // Green color success
  }

  // Sidebar toggle
  sidebarToggleBtn.addEventListener('click', () => {
    sidebarToggleBtn.classList.toggle('active');
    appContainer.classList.toggle('sidebar-active');
  });

  // Leave session
  leaveBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this session?')) {
      if (isHost) {
        stopScreenShare();
        // Close data connections
        Object.values(activeConnections).forEach(c => c.close());
        window.location.href = window.location.origin + window.location.pathname;
      } else {
        if (hostConnection) {
          hostConnection.close();
        }
        window.location.href = "https://imarticus.org";
      }
    }
  });
});
