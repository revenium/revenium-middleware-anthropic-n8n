import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ReveniumAnthropic implements ICredentialType {
  name = 'reveniumAnthropic';

  displayName = 'Revenium Anthropic Credentials';

  icon = 'file:ReveniumAnthropicChatModel/ReveniumAnthropic-v2.png' as const;

  documentationUrl =
    'https://github.com/revenium/revenium-middleware-anthropic-n8n';

  properties: INodeProperties[] = [
    {
      displayName: 'Anthropic API Key',
      name: 'anthropicApiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Your Anthropic API key for accessing Claude models',
    },
    {
      displayName: 'Anthropic Base URL',
      name: 'anthropicBaseUrl',
      type: 'string',
      default: 'https://api.anthropic.com',
      required: false,
      description:
        'The base URL for Anthropic API (default: https://api.anthropic.com)',
    },
    {
      displayName: 'Revenium Metering API Key',
      name: 'reveniumApiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Your Revenium API key for tracking usage and costs',
    },
    {
      displayName: 'Revenium Metering Base URL',
      name: 'reveniumBaseUrl',
      type: 'string',
      required: true,
      default: 'https://api.revenium.ai',
      description: 'Revenium API base URL (default: https://api.revenium.ai)',
    },
    {
      displayName: 'Print Summary',
      name: 'printSummary',
      type: 'options',
      options: [
        {
          name: 'Disabled',
          value: false,
        },
        {
          name: 'Human Readable',
          value: 'human',
        },
        {
          name: 'JSON',
          value: 'json',
        },
      ],
      default: false,
      required: false,
      description:
        'Print usage summary to console after each request (disabled by default)',
    },
    {
      displayName: 'Team ID',
      name: 'teamId',
      type: 'string',
      default: '',
      required: false,
      description: 'Your Revenium Team ID for cost retrieval (optional)',
    },
  ];
}
