// @flow
const { db } = require('./db');
// $FlowFixMe
import { UserError } from 'graphql-errors';

const getChannelsByCommunity = (
  communityId: string
): Promise<Array<Object>> => {
  return db
    .table('channels')
    .getAll(communityId, { index: 'communityId' })
    .filter(channel => db.not(channel.hasFields('isDeleted')))
    .run();
};

const getChannelsByUser = (userId: string): Promise<Array<Object>> => {
  return db
    .table('channels')
    .filter(channel => channel('members').contains(userId))
    .filter(channel => db.not(channel.hasFields('isDeleted')))
    .run();
};

const getChannelBySlug = (
  channelSlug: string,
  communitySlug: string
): Promise<Object> => {
  return db
    .table('channels')
    .eqJoin('communityId', db.table('communities'))
    .filter({
      left: {
        slug: channelSlug,
      },
      right: {
        slug: communitySlug,
      },
    })
    .filter(channel => db.not(channel.hasFields('isDeleted')))
    .run()
    .then(result => {
      if (result && result[0]) {
        return result[0].left;
      }
    });
};

type GetChannelByIdArgs = {
  id: string,
};

type GetChannelBySlugArgs = {
  slug: string,
  communitySlug: string,
};

export type GetChannelArgs = GetChannelByIdArgs | GetChannelBySlugArgs;

const getChannels = (channelIds: Array<string>): Promise<Array<Object>> => {
  return db
    .table('channels')
    .getAll(...channelIds)
    .filter(channel => db.not(channel.hasFields('isDeleted')))
    .run();
};

const getChannelMetaData = (channelId: string): Promise<Array<number>> => {
  const getThreadCount = db
    .table('threads')
    .getAll(channelId, { index: 'channelId' })
    .count()
    .run();
  const getMemberCount = db
    .table('channels')
    .get(channelId)
    .getField('members')
    .count()
    .run();

  return Promise.all([getThreadCount, getMemberCount]);
};

export type CreateChannelArguments = {
  input: {
    communityId: string,
    name: string,
    description: string,
    slug: string,
    isPrivate: Boolean,
  },
};

export type EditChannelArguments = {
  input: {
    channelId: string,
    name: string,
    description: string,
    slug: string,
    isPrivate: Boolean,
  },
};

const createChannel = (
  {
    input: { communityId, name, slug, description, isPrivate },
  }: CreateChannelArguments,
  creatorId: string
): Promise<Object> => {
  return db
    .table('channels')
    .insert(
      {
        communityId,
        createdAt: new Date(),
        name,
        description,
        slug,
        isPrivate,
        members: [creatorId],
        owners: [creatorId],
        moderators: [],
        pendingUsers: [],
        blockedUsers: [],
      },
      { returnChanges: true }
    )
    .run()
    .then(result => result.changes[0].new_val);
};

const editChannel = ({
  input: { name, slug, description, isPrivate, channelId },
}: EditChannelArguments): Object => {
  return db
    .table('channels')
    .get(channelId)
    .run()
    .then(result => {
      return Object.assign({}, result, {
        name,
        description,
        slug,
        isPrivate,
      });
    })
    .then(obj => {
      return db
        .table('channels')
        .get(channelId)
        .update({ ...obj }, { returnChanges: 'always' })
        .run()
        .then(result => {
          // if an update happened
          if (result.replaced === 1) {
            return result.changes[0].new_val;
          }

          // an update was triggered from the client, but no data was changed
          if (result.unchanged === 1) {
            return result.changes[0].old_val;
          }
        });
    });
};

/*
  We delete data non-destructively, meaning the record does not get cleared
  from the db.
*/
const deleteChannel = (channelId: string): Promise<Boolean> => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      {
        isDeleted: true,
        slug: db.uuid(),
      },
      {
        returnChanges: true,
        nonAtomic: true,
      }
    )
    .run()
    .then(result => {
      // update was successful
      if (result.replaced >= 1) {
        return true;
      }

      // update failed
      return new UserError(
        "Something went wrong and we weren't able to delete this channel."
      );
    });
};

const leaveChannel = (channelId: string, userId: string): Promise<Object> => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        members: row('members').filter(item => item.ne(userId)),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const joinChannel = (channelId: string, userId: string): Promise<Object> => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        members: row('members').append(userId),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const removeRequestToJoinChannel = (
  channelId: string,
  userId: string
): Object => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        pendingUsers: row('pendingUsers').filter(item => item.ne(userId)),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const addRequestToJoinChannel = (channelId: string, userId: string): Object => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        pendingUsers: row('pendingUsers').append(userId),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const removeBlockedUser = (channelId: string, userId: string): Object => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        blockedUsers: row('blockedUsers').filter(item => item.ne(userId)),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const addBlockedUser = (channelId: string, userId: string): Object => {
  return db
    .table('channels')
    .get(channelId)
    .update(
      row => ({
        blockedUsers: row('blockedUsers').append(userId),
      }),
      { returnChanges: true }
    )
    .run()
    .then(
      ({ changes }) =>
        changes.length > 0
          ? changes[0].new_val
          : db.table('channels').get(channelId).run()
    );
};

const getTopChannels = (amount: number): Array<Object> => {
  return db.table('channels').orderBy(db.desc('members')).limit(amount).run();
};

const getChannelMemberCount = (channelId: string): number => {
  return db.table('channels').get(channelId)('members').count().run();
};

module.exports = {
  getChannelBySlug,
  getChannelMetaData,
  getChannelsByUser,
  getChannelsByCommunity,
  createChannel,
  editChannel,
  deleteChannel,
  leaveChannel,
  joinChannel,
  getTopChannels,
  getChannelMemberCount,
  getChannels,
  addRequestToJoinChannel,
  removeRequestToJoinChannel,
  addBlockedUser,
  removeBlockedUser,
};