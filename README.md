# Dicsword IRC Client

A desktop IRC client with Discord-inspired UI. Connect to multiple IRC servers simultaneously with an interface familiar to Discord users.

## Current Features

- **Discord-like UI**: Server list sidebar, channel list, and user list panels
- **Multi-server support**: Connect to multiple IRC servers simultaneously
- **Channel management**: Join/part channels with `/join` and `/part` commands
- **Private messaging**: Direct message support with `/msg` command
- **Server persistence**: Automatically saves and restores server connections
- **Channel listing**: Browse available channels with `/list` command
- **Basic IRC commands**: Support for common commands like `/me`, `/nick`, etc.
- **User management**: View channel participants with proper role highlighting
- **SSL support**: Connect to secure IRC servers
- **Server management**: Right-click to delete servers
- **Channel memory**: Remembers last active channel per server

## Missing Features

Compared to full-featured IRC clients, this project currently lacks:

- **Notifications**: No notification system for mentions or messages
- **File transfers**: No support for DCC file transfers
- **Scripting**: No plugin system or scripting capabilities
- **Color codes**: Limited support for IRC color codes and formatting
- **CTCP support**: Limited handling of Client-To-Client Protocol commands
- **Identity management**: No NickServ integration or identity management
- **Logging**: No built-in conversation logging
- **URL detection**: No automatic URL detection or preview
- **Theming**: No support for custom themes or appearance customization

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the application:
   ```
   electron .
   ```

## Usage

1. Click the "+" button to add a new IRC server
2. Enter server details (name, address, port, nickname)
3. Use the "+" button in the channel list to browse and join channels
4. Right-click on server icons to delete servers
5. Type `/help` in the message box to see available commands

## Built With

- Electron
- irc-framework
- electron-store

## License

MIT