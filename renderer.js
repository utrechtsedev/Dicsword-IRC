// renderer.js
const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');
const { Menu, MenuItem } = remote;
const IRC = require('irc-framework');

// Store for all our IRC connections and state
const state = {
  servers: {},
  activeServer: null,
  activeChannel: null
};

// DOM Elements
const serversList = document.getElementById('servers');
const channelsList = document.getElementById('channels');
const messagesList = document.getElementById('messages');
const usersList = document.getElementById('users');
const messageBox = document.getElementById('message-box');
const serverModal = document.getElementById('server-modal');
const channelModal = document.getElementById('channel-modal');
const addServerBtn = document.getElementById('add-server-btn');
const serverForm = document.getElementById('server-form');
const currentServerDisplay = document.getElementById('current-server');
const currentChannelDisplay = document.getElementById('current-channel');
const channelListElement = document.getElementById('channel-list');
const channelSearchInput = document.getElementById('channel-search');

// Show server connection modal
addServerBtn.addEventListener('click', () => {
  serverModal.style.display = 'block';
});

// Close modals when clicking the X
document.querySelectorAll('.close').forEach(closeBtn => {
  closeBtn.addEventListener('click', function() {
    this.parentElement.parentElement.style.display = 'none';
  });
});

// Close modals when clicking outside of them
window.addEventListener('click', (event) => {
  if (event.target === serverModal) {
    serverModal.style.display = 'none';
  }
  if (event.target === channelModal) {
    channelModal.style.display = 'none';
  }
});

// Handle server form submission
serverForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const serverName = document.getElementById('server-name').value;
  const serverAddress = document.getElementById('server-address').value;
  const serverPort = parseInt(document.getElementById('server-port').value);
  const nickname = document.getElementById('nickname').value;
  const password = document.getElementById('server-password').value;
  const ssl = document.getElementById('server-ssl').checked;
  
  connectToServer(serverName, serverAddress, serverPort, nickname, password, ssl);
  serverModal.style.display = 'none';
  serverForm.reset();
});

// Connect to an IRC server
function connectToServer(name, address, port, nickname, password = '', ssl = true) {
  const serverId = `server-${Date.now()}`;
  
  console.log(`Connecting to server: ${name} (${address}:${port}) as ${nickname}`);
  
  // Create server entry in state
  state.servers[serverId] = {
    id: serverId,
    name: name,
    address: address,
    port: port,
    nickname: nickname,
    password: password,
    ssl: ssl,
    client: new IRC.Client(),
    channels: {},
    channelList: [],
    status: 'connecting'
  };
  
  // Add server to UI immediately to provide feedback
  addServerToUI(serverId, name);
  
  // Create IRC client and connect
  const client = state.servers[serverId].client;
  
  const connectionOpts = {
    host: address,
    port: port,
    nick: nickname,
    username: nickname,
    gecos: 'Discord-Style IRC Client',
    tls: ssl,
    rejectUnauthorized: false // Allow self-signed certificates
  };
  
  // Add password if provided
  if (password) {
    connectionOpts.password = password;
  }
  
  client.connect(connectionOpts);
  
  // Set as active server
  selectServer(serverId);
  
  // Add system message to show connecting status
  addSystemMessage(serverId, null, `Connecting to ${address}:${port} as ${nickname}${ssl ? ' (SSL)' : ''}...`);
  
  // Register event handlers
  client.on('registered', () => {
    // Successfully connected to server
    state.servers[serverId].status = 'connected';
    updateServerStatus(serverId);
    addSystemMessage(serverId, null, `Connected to ${address}:${port} as ${nickname}`);
    
    // Add this line to request channel list from the server
    setTimeout(() => {
      client.raw('NAMES', '*');
      client.raw('LIST');
    }, 2000);
    
    // Save servers to persistent storage
    saveServers();
  });
  
  // Add additional connection event handlers
  client.on('connected', () => {
    state.servers[serverId].status = 'connected';
    updateServerStatus(serverId);
  });
  
  client.on('message', (event) => {
    const { target, nick, message } = event;
    
    // Check if message is for a channel we're in
    if (state.servers[serverId].channels[target]) {
      addUserMessage(serverId, target, nick, message);
    }
    // Private message
    else if (target === state.servers[serverId].nickname) {
      // Handle private messages (creates a PM channel)
      const pmChannelId = `pm-${nick}`;
      
      // Create PM channel if it doesn't exist
      if (!state.servers[serverId].channels[pmChannelId]) {
        state.servers[serverId].channels[pmChannelId] = {
          id: pmChannelId,
          name: nick,
          topic: `Private conversation with ${nick}`,
          users: {},
          messages: []
        };
        
        // Add PM channel to UI if this is the active server
        if (state.activeServer === serverId) {
          addChannelToUI(serverId, pmChannelId, nick, true);
        }
      }
      
      addUserMessage(serverId, pmChannelId, nick, message);
    }
  });
  
  client.on('join', (event) => {
    const { channel, nick } = event;
    
    console.log(`Join event: ${nick} joined ${channel}`);
    
    // If we joined the channel
    if (nick === state.servers[serverId].nickname) {
      console.log(`We joined channel: ${channel}`);
      // Create channel object if it doesn't exist
      if (!state.servers[serverId].channels[channel]) {
        state.servers[serverId].channels[channel] = {
          id: channel,
          name: channel,
          topic: '',
          users: {},
          messages: []
        };
        
        // Add channel to UI if this is the active server
        if (state.activeServer === serverId) {
          addChannelToUI(serverId, channel, channel);
        }
      }
      
      addSystemMessage(serverId, channel, `You joined ${channel}`);
      
      // Select the new channel if it's our first one
      if (Object.keys(state.servers[serverId].channels).length === 1) {
        selectChannel(serverId, channel);
      }
    } 
    // Someone else joined
    else {
      // Add user to channel's user list
      if (state.servers[serverId].channels[channel]) {
        state.servers[serverId].channels[channel].users[nick] = {
          nick: nick,
          mode: ''  // No special privileges yet
        };
        
        // Update user list in UI if this is the active channel
        if (state.activeServer === serverId && state.activeChannel === channel) {
          updateUserList(serverId, channel);
        }
        
        addSystemMessage(serverId, channel, `${nick} joined the channel`);
      }
    }
  });
  
  client.on('part', (event) => {
    const { channel, nick } = event;
    
    // If we left the channel
    if (nick === state.servers[serverId].nickname) {
      addSystemMessage(serverId, channel, `You left ${channel}`);
      
      // Remove channel from UI if this is the active server
      if (state.activeServer === serverId) {
        const channelElement = document.getElementById(`channel-${serverId}-${channel}`);
        if (channelElement) {
          channelElement.remove();
        }
      }
      
      // Delete channel from state
      delete state.servers[serverId].channels[channel];
      
      // If this was the active channel, select another one
      if (state.activeServer === serverId && state.activeChannel === channel) {
        const otherChannels = Object.keys(state.servers[serverId].channels);
        if (otherChannels.length > 0) {
          selectChannel(serverId, otherChannels[0]);
        } else {
          state.activeChannel = null;
          currentChannelDisplay.innerHTML = '<h3>Not in any channels</h3>';
          messagesList.innerHTML = '';
          usersList.innerHTML = '';
        }
      }
    } 
    // Someone else left
    else {
      // Remove user from channel's user list
      if (state.servers[serverId].channels[channel] && 
          state.servers[serverId].channels[channel].users[nick]) {
        delete state.servers[serverId].channels[channel].users[nick];
        
        // Update user list in UI if this is the active channel
        if (state.activeServer === serverId && state.activeChannel === channel) {
          updateUserList(serverId, channel);
        }
        
        addSystemMessage(serverId, channel, `${nick} left the channel`);
      }
    }
  });
  
  client.on('quit', (event) => {
    const { nick, message } = event;
    
    // Check all channels for this user
    Object.keys(state.servers[serverId].channels).forEach(channelId => {
      const channel = state.servers[serverId].channels[channelId];
      
      // If user was in this channel
      if (channel.users[nick]) {
        delete channel.users[nick];
        
        // Update user list in UI if this is the active channel
        if (state.activeServer === serverId && state.activeChannel === channelId) {
          updateUserList(serverId, channelId);
        }
        
        addSystemMessage(serverId, channelId, `${nick} quit (${message || 'No reason given'})`);
      }
    });
  });
  
  client.on('kick', (event) => {
    const { channel, nick, by, reason } = event;
    
    // If we were kicked
    if (nick === state.servers[serverId].nickname) {
      addSystemMessage(serverId, channel, `You were kicked from ${channel} by ${by} (${reason || 'No reason given'})`);
      
      // Remove channel from UI if this is the active server
      if (state.activeServer === serverId) {
        const channelElement = document.getElementById(`channel-${serverId}-${channel}`);
        if (channelElement) {
          channelElement.remove();
        }
      }
      
      // Delete channel from state
      delete state.servers[serverId].channels[channel];
      
      // If this was the active channel, select another one
      if (state.activeServer === serverId && state.activeChannel === channel) {
        const otherChannels = Object.keys(state.servers[serverId].channels);
        if (otherChannels.length > 0) {
          selectChannel(serverId, otherChannels[0]);
        } else {
          state.activeChannel = null;
          currentChannelDisplay.innerHTML = '<h3>Not in any channels</h3>';
          messagesList.innerHTML = '';
          usersList.innerHTML = '';
        }
      }
    } 
    // Someone else was kicked
    else {
      // Remove user from channel's user list
      if (state.servers[serverId].channels[channel] && 
          state.servers[serverId].channels[channel].users[nick]) {
        delete state.servers[serverId].channels[channel].users[nick];
        
        // Update user list in UI if this is the active channel
        if (state.activeServer === serverId && state.activeChannel === channel) {
          updateUserList(serverId, channel);
        }
        
        addSystemMessage(serverId, channel, `${nick} was kicked by ${by} (${reason || 'No reason given'})`);
      }
    }
  });
  
  client.on('nick', (event) => {
    const { nick, new_nick } = event;
    
    // Update nick in all channels
    Object.keys(state.servers[serverId].channels).forEach(channelId => {
      const channel = state.servers[serverId].channels[channelId];
      
      // If user was in this channel
      if (channel.users[nick]) {
        // Create new user entry with the new nick
        channel.users[new_nick] = channel.users[nick];
        channel.users[new_nick].nick = new_nick;
        
        // Delete old entry
        delete channel.users[nick];
        
        // Update user list in UI if this is the active channel
        if (state.activeServer === serverId && state.activeChannel === channelId) {
          updateUserList(serverId, channelId);
        }
        
        addSystemMessage(serverId, channelId, `${nick} is now known as ${new_nick}`);
      }
    });
    
    // If this was our own nick change
    if (nick === state.servers[serverId].nickname) {
      state.servers[serverId].nickname = new_nick;
    }
  });
  
  client.on('topic', (event) => {
    const { channel, topic } = event;
    
    if (state.servers[serverId].channels[channel]) {
      state.servers[serverId].channels[channel].topic = topic;
      
      // Update topic in UI if this is the active channel
      if (state.activeServer === serverId && state.activeChannel === channel) {
        currentChannelDisplay.innerHTML = `<h3>${channel}</h3><div class="channel-topic">${topic || 'No topic set'}</div>`;
      }
      
      addSystemMessage(serverId, channel, `Topic: ${topic || 'No topic set'}`);
    }
  });
  
  client.on('userlist', (event) => {
    const { channel, users } = event;
    
    if (state.servers[serverId].channels[channel]) {
      // Clear existing users
      state.servers[serverId].channels[channel].users = {};
      
      // Add all users from the list
      users.forEach(user => {
        let mode = '';
        let nick = user.nick;
        
        // Extract mode symbols from nick
        if (nick.startsWith('@')) {
          mode = 'operator';
          nick = nick.substring(1);
        } else if (nick.startsWith('+')) {
          mode = 'voice';
          nick = nick.substring(1);
        }
        
        state.servers[serverId].channels[channel].users[nick] = {
          nick: nick,
          mode: mode
        };
      });
      
      // Update user list in UI if this is the active channel
      if (state.activeServer === serverId && state.activeChannel === channel) {
        updateUserList(serverId, channel);
      }
    }
  });
  
  // Add special handler for NAMES response
  client.on('names', (event) => {
    const { channel, users } = event;
    
    // If we're receiving NAMES for a channel we're not tracking yet,
    // it means we're already in that channel (e.g., via ZNC)
    if (!state.servers[serverId].channels[channel]) {
      console.log(`Adding previously joined channel: ${channel}`);
      state.servers[serverId].channels[channel] = {
        id: channel,
        name: channel,
        topic: '',
        users: {},
        messages: []
      };
      
      // Add channel to UI if this is the active server
      if (state.activeServer === serverId) {
        addChannelToUI(serverId, channel, channel);
      }
      
      // If this is our first channel, select it
      if (Object.keys(state.servers[serverId].channels).length === 1) {
        selectChannel(serverId, channel);
      }
    }
    
    // Update the user list for this channel
    const channelData = state.servers[serverId].channels[channel];
    if (channelData) {
      Object.keys(users).forEach(nickname => {
        const modes = users[nickname];
        let mode = '';
        
        if (modes.includes('@')) {
          mode = 'operator';
        } else if (modes.includes('+')) {
          mode = 'voice';
        }
        
        channelData.users[nickname] = {
          nick: nickname,
          mode: mode
        };
      });
      
      // Update user list if this is the active channel
      if (state.activeServer === serverId && state.activeChannel === channel) {
        updateUserList(serverId, channel);
      }
    }
  });
  
  client.on('channel list', (channels) => {
    // This is the event that gets fired with the complete list on some servers
    state.servers[serverId].channelList = channels.map(ch => ({
      channel: ch.channel,
      num_users: ch.users,
      topic: ch.topic || ''
    }));
    updateChannelList(serverId);
  });
  
  client.on('chanlist', (event) => {
    const { channel, users, topic } = event;
    
    // Add to channel list
    state.servers[serverId].channelList.push({
      channel: channel,
      num_users: users,
      topic: topic || ''
    });
  });
  
  client.on('channel list end', () => {
    // This gets triggered when the channel list is complete
    updateChannelList(serverId);
  });
  
  client.on('loggedin', () => {
    addSystemMessage(serverId, null, 'Successfully authenticated with server');
  });
  
  client.on('reconnecting', () => {
    state.servers[serverId].status = 'connecting';
    updateServerStatus(serverId);
    addSystemMessage(serverId, null, 'Reconnecting to server...');
  });

  client.on('close', () => {
    if (state.servers[serverId].status !== 'disconnected') {
      state.servers[serverId].status = 'disconnected';
      updateServerStatus(serverId);
      addSystemMessage(serverId, null, 'Disconnected from server');
    }
  });
  
  client.on('error', (error) => {
    console.error('IRC Error:', error);
    addSystemMessage(serverId, null, `Error: ${error.message || 'Unknown error'}`);
  });
}

// Update server status in UI
function updateServerStatus(serverId) {
  const server = state.servers[serverId];
  const serverElement = document.getElementById(`server-${serverId}`);
  
  if (serverElement) {
    // Update status class
    serverElement.classList.remove('connected', 'connecting', 'disconnected');
    serverElement.classList.add(server.status);
    
    // Update tooltip
    serverElement.title = `${server.name} (${server.status})`;
  }
}

// Add a server to the UI
function addServerToUI(serverId, name) {
  const serverElement = document.createElement('div');
  serverElement.id = `server-${serverId}`;
  serverElement.className = 'server-icon connecting';
  serverElement.textContent = name.charAt(0).toUpperCase();
  serverElement.title = `${name} (connecting)`;
  
  serverElement.addEventListener('click', () => {
    selectServer(serverId);
  });
  
  // Add context menu for server management
  serverElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showServerContextMenu(serverId);
  });
  
  serversList.appendChild(serverElement);
}

// Add a channel to the UI
function addChannelToUI(serverId, channelId, name, isPM = false) {
  // Check if channel already exists in UI
  const existingChannel = document.getElementById(`channel-${serverId}-${channelId}`);
  if (existingChannel) {
    return;
  }
  
  const channelElement = document.createElement('div');
  channelElement.id = `channel-${serverId}-${channelId}`;
  channelElement.className = 'channel-item';
  
  // Use different icon for PMs
  if (isPM) {
    channelElement.innerHTML = `<i class="fas fa-user"></i>${name}`;
  } else {
    channelElement.innerHTML = `<i class="fas fa-hashtag"></i>${name}`;
  }
  
  channelElement.addEventListener('click', () => {
    selectChannel(serverId, channelId);
  });
  
  channelsList.appendChild(channelElement);
}

// Select a server
function selectServer(serverId) {
  // Remove 'selected' class from all servers
  document.querySelectorAll('.server-icon').forEach(server => {
    server.classList.remove('selected');
  });
  
  // Add 'selected' class to the selected server
  const serverElement = document.getElementById(`server-${serverId}`);
  if (serverElement) {
    serverElement.classList.add('selected');
  }
  
  // Update state
  state.activeServer = serverId;
  
  // Update server header
  currentServerDisplay.innerHTML = `<h3>${state.servers[serverId].name}</h3>
    <div class="connection-status ${state.servers[serverId].status}">
      ${state.servers[serverId].status}
    </div>`;
  
  // Clear channel list
  channelsList.innerHTML = '';
  
  // Add an "add channel" button
  const addChannelElement = document.createElement('div');
  addChannelElement.className = 'add-channel';
  addChannelElement.innerHTML = '<i class="fas fa-plus"></i> Join Channel';
  addChannelElement.addEventListener('click', () => {
    // Clear previous channel list
    state.servers[serverId].channelList = [];
    channelListElement.innerHTML = '<div class="system-message">Loading channel list...</div>';
    
    // Request channel list from server
    state.servers[serverId].client.raw('LIST');
    
    // Show channel selection modal
    channelModal.style.display = 'block';
    
    // Set a longer timeout for servers that don't properly send list end event
    setTimeout(() => {
      if (channelListElement.innerHTML.includes('Loading channel list')) {
        updateChannelList(serverId);
      }
    }, 10000);
  });
  channelsList.appendChild(addChannelElement);
  
  // Add channels for this server
  const channels = state.servers[serverId].channels;
  Object.keys(channels).forEach(channelId => {
    const isPM = channelId.startsWith('pm-');
    addChannelToUI(serverId, channelId, channels[channelId].name, isPM);
  });
  
  // Select last active channel, or first available, or clear if none
  const channelIds = Object.keys(channels);
  if (channelIds.length > 0) {
    // Use last active channel if it exists
    const lastChannel = state.servers[serverId].lastActiveChannel;
    if (lastChannel && channels[lastChannel]) {
      selectChannel(serverId, lastChannel);
    } else {
      selectChannel(serverId, channelIds[0]);
    }
  } else {
    state.activeChannel = null;
    currentChannelDisplay.innerHTML = '<h3>Not in any channels</h3>';
    messagesList.innerHTML = '<div class="system-message">Join a channel or use /join #channel</div>';
    usersList.innerHTML = '';
  }
}

// Select a channel
function selectChannel(serverId, channelId) {
  // Remove 'active' class from all channels
  document.querySelectorAll('.channel-item').forEach(channel => {
    channel.classList.remove('active');
  });
  
  // Add 'active' class to the selected channel
  const channelElement = document.getElementById(`channel-${serverId}-${channelId}`);
  if (channelElement) {
    channelElement.classList.add('active');
  }
  
  // Update state
  state.activeChannel = channelId;
  
  // Save this as the last active channel for this server
  state.servers[serverId].lastActiveChannel = channelId;
  
  // Update channel header
  const channel = state.servers[serverId].channels[channelId];
  currentChannelDisplay.innerHTML = `<h3>${channel.name}</h3><div class="channel-topic">${channel.topic || 'No topic set'}</div>`;
  
  // Update messages
  updateMessages(serverId, channelId);
  
  // Update user list
  updateUserList(serverId, channelId);
}

// Update messages for a channel
function updateMessages(serverId, channelId) {
  messagesList.innerHTML = '';
  
  const messages = state.servers[serverId].channels[channelId].messages;
  
  messages.forEach(msg => {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    if (msg.type === 'system') {
      messageElement.innerHTML = `
        <div class="system-message">
          ${msg.text}
        </div>
      `;
    } else {
      const initial = msg.nick.charAt(0).toUpperCase();
      messageElement.innerHTML = `
        <div class="message-avatar">${initial}</div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-author">${msg.nick}</span>
            <span class="message-timestamp">${formatTime(msg.timestamp)}</span>
          </div>
          <div class="message-text">${msg.text}</div>
        </div>
      `;
    }
    
    messagesList.appendChild(messageElement);
  });
  
  // Scroll to bottom
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Update user list for a channel
function updateUserList(serverId, channelId) {
  usersList.innerHTML = '';
  
  const users = state.servers[serverId].channels[channelId].users;
  
  // Sort users by mode and then alphabetically
  const sortedUsers = Object.keys(users).sort((a, b) => {
    const userA = users[a];
    const userB = users[b];
    
    // Operators first, then voiced users, then normal users
    if (userA.mode === 'operator' && userB.mode !== 'operator') return -1;
    if (userA.mode !== 'operator' && userB.mode === 'operator') return 1;
    if (userA.mode === 'voice' && userB.mode !== 'voice') return -1;
    if (userA.mode !== 'voice' && userB.mode === 'voice') return 1;
    
    // If same mode, sort alphabetically
    return a.localeCompare(b);
  });
  
  sortedUsers.forEach(nick => {
    const user = users[nick];
    const userElement = document.createElement('div');
    userElement.className = 'user-item';
    
    const initial = nick.charAt(0).toUpperCase();
    
    // Different background colors for different user modes
    let bgColor = '#7289da'; // Default color
    if (user.mode === 'operator') {
      bgColor = '#f04747'; // Red for operators
    } else if (user.mode === 'voice') {
      bgColor = '#43b581'; // Green for voiced users
    }
    
    userElement.innerHTML = `
      <div class="user-avatar" style="background-color: ${bgColor};">${initial}</div>
      <div class="user-name">${nick}</div>
    `;
    
    usersList.appendChild(userElement);
  });
}

// Update channel list in the modal
function updateChannelList(serverId) {
  channelListElement.innerHTML = '';
  
  const channels = state.servers[serverId].channelList;
  
  if (channels.length === 0) {
    channelListElement.innerHTML = '<div class="system-message">No channels found or still loading...</div>';
    return;
  }
  
  // Sort channels by number of users (descending)
  channels.sort((a, b) => b.num_users - a.num_users);
  
  channels.forEach(channel => {
    const channelElement = document.createElement('div');
    channelElement.className = 'channel-list-item';
    channelElement.innerHTML = `
      <strong>#${channel.channel}</strong> (${channel.num_users} users)
      <div>${channel.topic || 'No topic set'}</div>
    `;
    
    channelElement.addEventListener('click', () => {
      // Join channel
      state.servers[serverId].client.join(channel.channel);
      
      // Close modal
      channelModal.style.display = 'none';
    });
    
    channelListElement.appendChild(channelElement);
  });
}

// Add a system message to a channel
function addSystemMessage(serverId, channelId, text) {
  // If no channelId provided, add to all channels for this server
  if (!channelId) {
    if (Object.keys(state.servers[serverId].channels).length > 0) {
      Object.keys(state.servers[serverId].channels).forEach(cid => {
        addSystemMessage(serverId, cid, text);
      });
    } else {
      // If no channels exist, create a special system channel
      if (!state.servers[serverId].channels["#system"]) {
        state.servers[serverId].channels["#system"] = {
          id: "#system",
          name: "System Messages",
          topic: 'Server system messages',
          users: {},
          messages: []
        };
        
        // Add channel to UI if this is the active server
        if (state.activeServer === serverId) {
          addChannelToUI(serverId, "#system", "System Messages");
          selectChannel(serverId, "#system");
        }
      }
      
      addSystemMessage(serverId, "#system", text);
    }
    return;
  }
  
  const channel = state.servers[serverId].channels[channelId];
  if (!channel) return;
  
  channel.messages.push({
    type: 'system',
    text: text,
    timestamp: Date.now()
  });
  
  // Update UI if this is the active channel
  if (state.activeServer === serverId && state.activeChannel === channelId) {
    updateMessages(serverId, channelId);
  }
}

// Add a user message to a channel
function addUserMessage(serverId, channelId, nick, text) {
  const channel = state.servers[serverId].channels[channelId];
  if (!channel) return;
  
  channel.messages.push({
    type: 'user',
    nick: nick,
    text: text,
    timestamp: Date.now()
  });
  
  // Update UI if this is the active channel
  if (state.activeServer === serverId && state.activeChannel === channelId) {
    updateMessages(serverId, channelId);
  }
}

// Handle sending a message
messageBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    
    const text = messageBox.value.trim();
    if (!text) return;
    
    // Check if it's a command
    if (text.startsWith('/')) {
      handleCommand(text);
    } 
    // Normal message
    else if (state.activeServer && state.activeChannel) {
      const serverId = state.activeServer;
      const channelId = state.activeChannel;
      const server = state.servers[serverId];
      
      // Send message to IRC server
      server.client.say(channelId, text);
      
      // Add message to our UI
      addUserMessage(serverId, channelId, server.nickname, text);
    }
    
    // Clear input
    messageBox.value = '';
  }
});

// Handle IRC commands
function handleCommand(commandText) {
  if (!state.activeServer) return;
  
  const serverId = state.activeServer;
  const server = state.servers[serverId];
  const client = server.client;
  
  // Split command into parts
  const parts = commandText.split(' ');
  const command = parts[0].toLowerCase();
  
  // Add system message to show the command was recognized
  addSystemMessage(serverId, state.activeChannel, `Executing command: ${command}`);
  
  switch (command) {
    case '/join':
      if (parts.length >= 2) {
        const channel = parts[1];
        client.join(channel);
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Usage: /join #channel');
      }
      break;
      
    case '/part':
    case '/leave':
      if (state.activeChannel && state.activeChannel.startsWith('#')) {
        client.part(state.activeChannel, parts.slice(1).join(' '));
      } else {
        addSystemMessage(serverId, state.activeChannel, 'You are not in a channel');
      }
      break;
      
    case '/msg':
    case '/query':
      if (parts.length >= 3) {
        const target = parts[1];
        const message = parts.slice(2).join(' ');
        
        // Send private message
        client.say(target, message);
        
        // Create or use existing PM channel
        const pmChannelId = `pm-${target}`;
        
        // Create PM channel if it doesn't exist
        if (!server.channels[pmChannelId]) {
          server.channels[pmChannelId] = {
            id: pmChannelId,
            name: target,
            topic: `Private conversation with ${target}`,
            users: {},
            messages: []
          };
          
          // Add PM channel to UI
          addChannelToUI(serverId, pmChannelId, target, true);
        }
        
        // Add message to our UI
        addUserMessage(serverId, pmChannelId, server.nickname, message);
        
        // Switch to PM channel
        selectChannel(serverId, pmChannelId);
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Usage: /msg nickname message');
      }
      break;
      
    case '/disconnect':
      client.quit('Disconnected by user');
      
      // Update server status
      state.servers[serverId].status = 'disconnected';
      updateServerStatus(serverId);
      
      // Add system message
      addSystemMessage(serverId, null, `Disconnected from server`);
      break;
      
    case '/nick':
      if (parts.length >= 2) {
        const newNick = parts[1];
        client.changeNick(newNick);
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Usage: /nick newnickname');
      }
      break;
      
    case '/list':
      // Clear previous channel list
      state.servers[serverId].channelList = [];
      channelListElement.innerHTML = '<div class="system-message">Loading channel list...</div>';
      
      // Request channel list from server
      client.raw('LIST');
      
      // Show channel selection modal
      channelModal.style.display = 'block';
      
      // Set a longer timeout for servers that don't properly send list end event
      setTimeout(() => {
        if (channelListElement.innerHTML.includes('Loading channel list')) {
          updateChannelList(serverId);
        }
      }, 10000);
      break;
      
    case '/me':
      if (state.activeChannel) {
        const action = parts.slice(1).join(' ');
        client.action(state.activeChannel, action);
        
        // Add action to our UI
        addSystemMessage(serverId, state.activeChannel, `* ${server.nickname} ${action}`);
      }
      break;
      
    case '/topic':
      if (state.activeChannel && state.activeChannel.startsWith('#')) {
        if (parts.length >= 2) {
          const topic = parts.slice(1).join(' ');
          client.setTopic(state.activeChannel, topic);
        } else {
          // Just display the current topic
          const currentTopic = server.channels[state.activeChannel].topic;
          addSystemMessage(serverId, state.activeChannel, `Current topic: ${currentTopic || 'No topic set'}`);
        }
      } else {
        addSystemMessage(serverId, state.activeChannel, 'You are not in a channel');
      }
      break;
      
    case '/whois':
      if (parts.length >= 2) {
        const target = parts[1];
        client.whois(target);
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Usage: /whois nickname');
      }
      break;
      
    case '/kick':
      if (state.activeChannel && state.activeChannel.startsWith('#')) {
        if (parts.length >= 2) {
          const target = parts[1];
          const reason = parts.slice(2).join(' ') || 'No reason given';
          client.raw('KICK', state.activeChannel, target, reason);
        } else {
          addSystemMessage(serverId, state.activeChannel, 'Usage: /kick nickname [reason]');
        }
      } else {
        addSystemMessage(serverId, state.activeChannel, 'You are not in a channel');
      }
      break;
      
    case '/ban':
      if (state.activeChannel && state.activeChannel.startsWith('#')) {
        if (parts.length >= 2) {
          const target = parts[1];
          client.raw('MODE', state.activeChannel, '+b', target);
        } else {
          addSystemMessage(serverId, state.activeChannel, 'Usage: /ban nickname');
        }
      } else {
        addSystemMessage(serverId, state.activeChannel, 'You are not in a channel');
      }
      break;
      
    case '/unban':
      if (state.activeChannel && state.activeChannel.startsWith('#')) {
        if (parts.length >= 2) {
          const target = parts[1];
          client.raw('MODE', state.activeChannel, '-b', target);
        } else {
          addSystemMessage(serverId, state.activeChannel, 'Usage: /unban nickname');
        }
      } else {
        addSystemMessage(serverId, state.activeChannel, 'You are not in a channel');
      }
      break;
      
    case '/quit':
      const quitMessage = parts.slice(1).join(' ') || 'Discord-Style IRC Client';
      client.quit(quitMessage);
      
      // Update server status
      state.servers[serverId].status = 'disconnected';
      updateServerStatus(serverId);
      
      // Add system message
      addSystemMessage(serverId, null, `Disconnected from server (${quitMessage})`);
      break;
      
    case '/raw':
    case '/quote':
      if (parts.length >= 2) {
        const rawCommand = parts.slice(1).join(' ');
        client.raw(rawCommand);
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Usage: /raw IRC_COMMAND');
      }
      break;
      
    case '/connect':
      if (server.status === 'disconnected') {
        addSystemMessage(serverId, state.activeChannel, 'Reconnecting to server...');
        
        // Update server status
        state.servers[serverId].status = 'connecting';
        updateServerStatus(serverId);
        
        // Reconnect to server
        client.connect({
          host: server.address,
          port: server.port,
          nick: server.nickname,
          username: server.nickname,
          gecos: 'Discord-Style IRC Client'
        });
      } else {
        addSystemMessage(serverId, state.activeChannel, 'Already connected or connecting to server');
      }
      break;
      
    default:
      addSystemMessage(serverId, state.activeChannel, `Unknown command: ${command}`);
  }
}

// Channel search
channelSearchInput.addEventListener('input', () => {
  if (!state.activeServer) return;
  
  const serverId = state.activeServer;
  const searchTerm = channelSearchInput.value.toLowerCase();
  
  const channels = state.servers[serverId].channelList;
  
  channelListElement.innerHTML = '';
  
  channels.filter(channel => {
    // Search in channel name and topic
    return channel.channel.toLowerCase().includes(searchTerm) || 
           (channel.topic && channel.topic.toLowerCase().includes(searchTerm));
  }).forEach(channel => {
    const channelElement = document.createElement('div');
    channelElement.className = 'channel-list-item';
    channelElement.innerHTML = `
      <strong>#${channel.channel}</strong> (${channel.num_users} users)
      <div>${channel.topic || 'No topic set'}</div>
    `;
    
    channelElement.addEventListener('click', () => {
      // Join channel
      state.servers[serverId].client.join(channel.channel);
      
      // Close modal
      channelModal.style.display = 'none';
    });
    
    channelListElement.appendChild(channelElement);
  });
});

// Helper function to format timestamp
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

// Save servers to persistent storage
async function saveServers() {
  const serversToSave = {};
  
  Object.keys(state.servers).forEach(serverId => {
    const server = state.servers[serverId];
    serversToSave[serverId] = {
      id: serverId,
      name: server.name,
      address: server.address,
      port: server.port,
      nickname: server.nickname,
      password: server.password,
      ssl: server.ssl,
      lastActiveChannel: server.lastActiveChannel
    };
  });
  
  try {
    await ipcRenderer.invoke('save-servers', serversToSave);
  } catch (error) {
    console.error('Error saving servers:', error);
  }
}

// Load servers from persistent storage
async function loadServers() {
  try {
    const savedServers = await ipcRenderer.invoke('load-servers');
    
    if (savedServers && Object.keys(savedServers).length > 0) {
      Object.keys(savedServers).forEach(serverId => {
        const server = savedServers[serverId];
        connectToServer(server.name, server.address, server.port, server.nickname, server.password, server.ssl);
        
        // Restore last active channel if it exists
        if (server.lastActiveChannel) {
          state.servers[serverId].lastActiveChannel = server.lastActiveChannel;
        }
      });
    }
  } catch (error) {
    console.error('Error loading servers:', error);
  }
}

// Show server context menu
function showServerContextMenu(serverId) {
  const menu = new Menu();
  
  menu.append(new MenuItem({
    label: 'Delete Server',
    click() {
      deleteServer(serverId);
    }
  }));
  
  menu.popup({ window: remote.getCurrentWindow() });
}

// Delete server
function deleteServer(serverId) {
  const server = state.servers[serverId];
  
  // If connected, disconnect first
  if (server.status === 'connected' || server.status === 'connecting') {
    server.client.quit('Server deleted by user');
  }
  
  // Remove server from UI
  const serverElement = document.getElementById(`server-${serverId}`);
  if (serverElement) {
    serverElement.remove();
  }
  
  // If this was the active server, clear UI
  if (state.activeServer === serverId) {
    state.activeServer = null;
    state.activeChannel = null;
    
    // Clear UI
    currentServerDisplay.innerHTML = '<h3>No servers connected</h3>';
    currentChannelDisplay.innerHTML = '<h3>Select a server</h3>';
    channelsList.innerHTML = '';
    messagesList.innerHTML = '';
    usersList.innerHTML = '';
    
    // Select another server if available
    const otherServers = Object.keys(state.servers).filter(id => id !== serverId);
    if (otherServers.length > 0) {
      selectServer(otherServers[0]);
    }
  }
  
  // Delete server from state
  delete state.servers[serverId];
  
  // Update persistent storage
  saveServers();
}

// Load saved servers when the app starts
document.addEventListener('DOMContentLoaded', () => {
  loadServers();
});