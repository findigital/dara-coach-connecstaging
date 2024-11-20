import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Input data
interface EmailRequest {
  userEmail: string;
  scheduledFor: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const emailRequest: EmailRequest = await req.json();
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
    
    // Fetch the user's latest session details
    const { data: latestSession } = await supabase
      .from('coaching_sessions')
      .select(`
        title,
        summary,
        session_notes (content)
      `)
      .eq('user_id', (await supabase.auth.admin.getUserById(emailRequest.userEmail)).data.user?.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const scheduledDate = new Date(emailRequest.scheduledFor);
    const formattedDate = scheduledDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    
    const formattedTime = scheduledDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #1a365d; margin-bottom: 10px;">Your Session is Scheduled!</h1>
          <p style="color: #4a5568; font-size: 18px; margin-bottom: 20px;">
            Mark your calendar for ${formattedDate} at ${formattedTime}
          </p>
        </div>

        <div style="background-color: #f7fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #2d3748; margin-bottom: 15px;">Session Details</h2>
          <p style="color: #4a5568; line-height: 1.6;">
            We look forward to continuing our conversation and supporting your journey.
            Please make sure to be in a quiet, comfortable space where you can focus on our session.
          </p>
        </div>

        ${latestSession ? `
          <div style="background-color: #f7fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #2d3748; margin-bottom: 15px;">Previous Session Recap</h2>
            ${latestSession.title ? `
              <h3 style="color: #4a5568; margin-bottom: 10px;">Topic: ${latestSession.title}</h3>
            ` : ''}
            ${latestSession.summary ? `
              <div style="margin-bottom: 15px;">
                <h4 style="color: #4a5568; margin-bottom: 5px;">Summary:</h4>
                <p style="color: #4a5568; line-height: 1.6;">${latestSession.summary}</p>
              </div>
            ` : ''}
            ${latestSession.session_notes?.length > 0 ? `
              <div>
                <h4 style="color: #4a5568; margin-bottom: 5px;">Key Notes:</h4>
                <p style="color: #4a5568; line-height: 1.6;">${latestSession.session_notes[0].content}</p>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div style="background-color: #edf2f7; border-radius: 8px; padding: 20px;">
          <h3 style="color: #2d3748; margin-bottom: 10px;">Preparation Tips</h3>
          <ul style="color: #4a5568; line-height: 1.6; padding-left: 20px;">
            <li>Find a quiet, private space</li>
            <li>Have a notebook ready for notes</li>
            <li>Test your audio and video beforehand</li>
            <li>Take a few deep breaths before we begin</li>
          </ul>
        </div>

        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
          <p style="color: #718096; font-size: 14px;">
            If you need to reschedule, please do so at least 24 hours in advance.
          </p>
        </div>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Dara <dara@builtbyfn.com>",
        to: emailRequest.userEmail,
        subject: "Your Session with Dara is Scheduled!",
        html: emailContent,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    } else {
      const error = await res.text();
      console.error("Resend API error:", error);
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error: any) {
    console.error("Error in send-schedule-email function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);