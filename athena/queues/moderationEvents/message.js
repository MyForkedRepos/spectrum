// @flow
const debug = require('debug')('athena:queue:channel-notification');
import { getUserById } from '../../models/user';
import { getThreadById } from '../../models/thread';
import { getCommunityById } from '../../models/community';
import { getChannelById } from '../../models/channel';
import { addQueue } from '../../utils/addQueue';
import type { DBMessage } from 'shared/types';
import { toState, toPlainText } from 'shared/draft-utils';
import getSpectrumScore from './spectrum';
import getPerspectiveScore from './perspective';
import { getUserPermissionsInCommunity } from '../../models/usersCommunities';

type JobData = {
  data: {
    message: DBMessage,
  },
};
export default async (job: JobData) => {
  debug('new job for admin message moderation');
  const { data: { message } } = job;

  const [user, thread] = await Promise.all([
    getUserById(message.senderId),
    getThreadById(message.threadId),
  ]);

  const [community, channel, permissions] = await Promise.all([
    getCommunityById(thread.communityId),
    getChannelById(thread.channelId),
    getUserPermissionsInCommunity(thread.communityId, user.id),
  ]);

  const text =
    message.messageType === 'draftjs'
      ? toPlainText(toState(JSON.parse(message.content.body)))
      : message.content.body;

  const meta = {
    authorId: message.senderId,
    communityId: community.id,
    joinedCommunityAt: permissions.createdAt,
    joinedSpectrumAt: user.createdAt,
    reputation: permissions.reputation,
  };

  const scores = await Promise.all([
    getSpectrumScore(text, message.id, meta),
    getPerspectiveScore(text),
  ]).catch(err =>
    console.log('Error getting message moderation scores from providers', err)
  );

  const spectrumScore = scores && scores[0];
  const perspectiveScore = scores && scores[1];

  // if neither models returned results
  if (!spectrumScore && !perspectiveScore) return;

  try {
    return addQueue('admin toxic content email', {
      type: 'message',
      text,
      user,
      thread,
      community,
      channel,
      toxicityConfidence: {
        spectrumScore,
        perspectiveScore,
      },
    });
  } catch (err) {
    console.log('\n\nerror getting message toxicity', err);
    return;
  }
};
