import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, type } = await req.json();
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    const chatHistory = messages?.map(msg => `${msg.role}: ${msg.content}`).join('\n') || '';
    let prompt = '';
    let updateTable = 'coaching_sessions';
    let updateColumn = '';

    switch (type) {
      case 'title':
        prompt = `Based on this coaching session chat history, generate a concise and descriptive title (max 5 words) that captures the main theme. Do not include any quotation marks in your response:\n\n${chatHistory}`;
        updateColumn = 'title';
        break;
      case 'summary':
        prompt = `Based on this coaching session chat history, provide a concise summary (2-3 sentences) of the key points discussed. Use "you" to refer to the person speaking with Dara, and use "Dara" instead of "assistant". Make it personal as if speaking to the person:\n\n${chatHistory}`;
        updateColumn = 'summary';
        break;
      case 'action_items':
        prompt = `Based on this coaching session chat history, generate 3-5 specific and unique action items. Each action item should be:
- Clear and actionable
- Start with a verb
- Under 15 words
- Focus on a different aspect or strategy
- Be directly related to the discussion

Format your response as a simple list with one action item per line, without numbers or bullet points.

Chat history:
${chatHistory}`;
        updateTable = 'action_items';
        break;
      default:
        throw new Error('Invalid generation type');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { 
            role: 'system', 
            content: type === 'action_items'
              ? 'You are a professional coach creating focused action items. Generate 3-5 unique, actionable tasks without any formatting or markup.'
              : 'You are a professional coach helping to analyze coaching sessions. Make the language personal and direct.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate insights');
    }

    const data = await response.json();
    const generatedContent = data.choices[0].message.content.trim();

    if (type === 'action_items') {
      const actionItems = generatedContent.split('\n')
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .slice(0, 5) // Ensure maximum of 5 items
        .map(content => ({
          session_id: sessionId,
          content: content
            .replace(/^[-*•\d]+\.\s*/, '')
            .replace(/^\s*-\s*/, '')
            .replace(/[*_~`]|(\[|\])/g, ''),
          completed: false,
        }));

      const { error: insertError } = await supabase
        .from('action_items')
        .insert(actionItems);

      if (insertError) throw insertError;
    } else {
      const { error: updateError } = await supabase
        .from(updateTable)
        .update({ [updateColumn]: generatedContent.replace(/[*_~`]|(\[|\])/g, '') })
        .eq('id', sessionId);

      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});