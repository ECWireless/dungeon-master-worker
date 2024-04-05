import axios from 'axios';
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction
} from 'discord.js';

import { ClientWithCommands, InvoiceXpDistroDocument } from '@/types';
import {
  HASURA_GRAPHQL_ADMIN_SECRET,
  HASURA_GRAPHQL_ENDPOINT
} from '@/utils/constants';
import { discordLogger, logError } from '@/utils/logger';

if (!HASURA_GRAPHQL_ENDPOINT || !HASURA_GRAPHQL_ADMIN_SECRET) {
  throw new Error(
    'Missing envs HASURA_GRAPHQL_ENDPOINT or HASURA_GRAPHQL_ADMIN_SECRET'
  );
}

export const getPlayerAddressesByDiscordTags = async (
  client: ClientWithCommands,
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | UserContextMenuCommandInteraction,
  discordMembers: GuildMember[]
): Promise<[Record<string, string> | null, string[] | null]> => {
  try {
    const discordUsernames = discordMembers.map(m => m?.user.tag);
    const query = `
      query MemberQuery {
        members(where: { contact_info: { discord: { _in: ${JSON.stringify(
          discordUsernames
        )}}}}) {
          eth_address
          contact_info {
            discord
          }
        }
      }
    `;

    const headers = {
      'x-hasura-admin-secret': HASURA_GRAPHQL_ADMIN_SECRET
    };

    const response = await axios({
      url: HASURA_GRAPHQL_ENDPOINT,
      method: 'post',
      headers,
      data: {
        query
      }
    });

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors));
    }

    const { members } = response.data.data;

    const discordTagToEthAddressMap = members.reduce(
      (
        acc: Record<string, string>,
        member: { eth_address: string; contact_info: { discord: string } }
      ) => {
        const { discord } = member.contact_info;
        const { eth_address: ethAddress } = member;
        acc[discord] = ethAddress;
        return acc;
      },
      {}
    );

    const discordTagsWithoutEthAddress = discordUsernames.filter(
      discordTag => !discordTagToEthAddressMap[discordTag]
    );

    return [discordTagToEthAddressMap, discordTagsWithoutEthAddress];
  } catch (err) {
    logError(
      client,
      interaction,
      err,
      `There was an error querying ETH addresses in DungeonMaster using Discord handles!`
    );
    return [null, null];
  }
};

export const getRaidDataFromInvoiceAddresses = async (
  client: ClientWithCommands,
  invoiceXpDistroData: Omit<InvoiceXpDistroDocument, '_id'>[]
): Promise<Omit<InvoiceXpDistroDocument, '_id'>[] | null> => {
  try {
    if (!HASURA_GRAPHQL_ADMIN_SECRET || !HASURA_GRAPHQL_ENDPOINT) {
      throw new Error(
        'Missing envs HASURA_GRAPHQL_ADMIN_SECRET or HASURA_GRAPHQL_ENDPOINT'
      );
    }

    const invoiceAddresses = invoiceXpDistroData.map(
      distroData => distroData.invoiceAddress
    );

    const query = `
      query RaidsQuery {
        raids(where: { invoice_address: { _in: ${JSON.stringify(
          invoiceAddresses
        )}}}) {
          invoice_address
          cleric {
            eth_address
            contact_info {
              discord
            }
          }
          hunter {
            eth_address
            contact_info {
              discord
            }
          }
          raid_parties {
            member {
              eth_address
              contact_info {
                discord
              }
            }
            raider_class_key
          }
        }
      }
    `;

    const headers = {
      'x-hasura-admin-secret': HASURA_GRAPHQL_ADMIN_SECRET
    };

    const response = await axios({
      url: HASURA_GRAPHQL_ENDPOINT,
      method: 'post',
      headers,
      data: {
        query
      }
    });

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors));
    }

    const { raids } = response.data.data as {
      raids: {
        invoice_address: string;
        cleric: { eth_address: string; contact_info: { discord: string } };
        hunter: { eth_address: string; contact_info: { discord: string } };
        raid_parties: {
          member: { eth_address: string; contact_info: { discord: string } };
          raider_class_key: string;
        }[];
      }[];
    };

    const invoiceXpDistroDataWithRaidData = invoiceXpDistroData.map(
      distroData => {
        const raidData = raids.find(
          raid => raid.invoice_address === distroData.invoiceAddress
        );

        if (!raidData) {
          return {
            ...distroData,
            discordTag: '',
            classKey: ''
          };
        }

        const { playerAddress } = distroData;
        const raidPartyMember = raidData.raid_parties.find(
          party => party.member.eth_address === playerAddress
        );

        if (playerAddress === raidData.cleric?.eth_address) {
          return {
            ...distroData,
            discordTag: raidData.cleric.contact_info.discord,
            classKey: 'ACCOUNT_MANAGER'
          };
        }

        if (playerAddress === raidData.hunter?.eth_address) {
          return {
            ...distroData,
            discordTag: raidData.hunter.contact_info.discord,
            classKey: 'BIZ_DEV'
          };
        }

        if (!raidPartyMember) {
          return {
            ...distroData,
            discordTag: '',
            classKey: ''
          };
        }

        return {
          ...distroData,
          discordTag: raidPartyMember.member.contact_info.discord,
          classKey: raidPartyMember.raider_class_key
        };
      }
    );

    return invoiceXpDistroDataWithRaidData;
  } catch (err) {
    discordLogger(JSON.stringify(err), client);
    return null;
  }
};
