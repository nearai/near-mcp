import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Command } from '@oclif/core';
import { homedir } from 'os';
import path from 'path';

import { createMcpServer } from '../../services';
import { stringify_bigint } from '../../utils';

export default class Tools extends Command {
  static description = 'List all available tools in the NEAR MCP server';

  static examples = ['<%= config.bin %> tools'];

  public async run(): Promise<void> {
    const keyDir = path.join(homedir(), '.near-keystore');
    try {
      const mcp = await createMcpServer(keyDir);
      const client = new Client({
        name: 'near-mcp-client',
        version: '1.0.0',
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await Promise.all([
        client.connect(clientTransport),
        mcp.server.connect(serverTransport),
      ]);
      const tools = (await client.listTools()).tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        args: tool.inputSchema.properties,
      }));
      console.log(stringify_bigint(tools));
    } catch (error) {
      this.error(
        error instanceof Error ? error.message : 'Unknown error occurred',
      );
    }
  }
}
