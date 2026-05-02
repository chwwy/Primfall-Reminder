const { EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Ensure the API key is passed correctly
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API || process.env.GEMINI_API_KEY || '');

const TRANSLATE_ROLE_ID = '1500146371557064766';

const systemPrompt = `You are a casual, natural-sounding translator. Translate the given text as a native speaker would in everyday conversation — preserve slang, informal tone, internet/modern speech, abbreviations, and casual expressions. Do NOT translate it formally or stiffly. If there's a word with no direct equivalent, pick the most natural equivalent used in that culture. Return ONLY the translated text, nothing else.`;

async function handleMessageCreate(message) {
  // Ignore bots
  if (message.author.bot) return;

  // Check if bot is mentioned
  if (!message.mentions.has(message.client.user)) return;

  // Only proceed if it is a reply
  if (!message.reference || !message.reference.messageId) {
    return;
  }

  try {
    // Fetch the replied-to message
    const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);

    if (!referencedMessage || !referencedMessage.content) return; // Nothing to translate

    // Determine direction
    // If the person who triggered the bot has the role ID 1500146371557064766 -> EN to ES
    let direction = 'es to en';
    const hasRole = message.member && message.member.roles.cache.has(TRANSLATE_ROLE_ID);
    if (hasRole) {
      direction = 'en to es';
    }

    const directionPrompt = direction === 'en to es'
      ? 'Translate from English to Spanish.'
      : 'Translate from Spanish to English.';

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: systemPrompt + '\n' + directionPrompt
    });

    const result = await model.generateContent(referencedMessage.content);
    const translatedText = result.response.text().trim();

    const embed = new EmbedBuilder()
      .setColor('#2b2d31') // Neutral dark color
      .setAuthor({
        name: referencedMessage.author.username,
        iconURL: referencedMessage.author.displayAvatarURL()
      });

    let description = '';

    // If the original message is itself a reply
    if (referencedMessage.reference && referencedMessage.reference.messageId) {
      try {
        const originalRef = await message.channel.messages.fetch(referencedMessage.reference.messageId);
        if (originalRef && originalRef.author) {
          description += `*Replying to @${originalRef.author.username}*\n`;
        }
      } catch (e) {
        // Ignore fetch errors
      }
    }

    description += `${translatedText}`;

    embed.setDescription(description);

    await message.channel.send({ embeds: [embed] });

  } catch (error) {
    console.error('Translation error:', error);
    await message.channel.send({ content: 'Sorry, I encountered an error while translating.' }).catch(() => { });
  }
}

module.exports = { handleMessageCreate };
