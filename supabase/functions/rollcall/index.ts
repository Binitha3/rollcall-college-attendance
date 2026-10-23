import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const encoder = new TextEncoder();
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Required Supabase environment variables are missing.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail("Malformed base64url value.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function requireUser(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) fail("Sign in to continue.", 401);
  const userClient = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const accessToken = authorization.slice("Bearer ".length);
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data.user) fail("Your sign-in has expired. Sign in again.", 401);
  let authMethods: string[];
  try {
    const payload = accessToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4)));
    authMethods = Array.isArray(claims.amr)
      ? claims.amr.map((item: { method?: unknown }) => item?.method).filter((method: unknown) => typeof method === "string")
      : [];
  } catch {
    fail("Your sign-in token is invalid. Sign in again.", 401);
  }
  return { ...data.user, authMethods: authMethods! };
}

async function requireRole(userId: string, role: string) {
  const { data, error } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (error) throw error;
  if (data.role !== role && data.role !== "admin") fail("You do not have permission for this action.", 403);
}

async function sessionCode(sessionId: string, slot: number) {
  const { data, error } = await admin.from("session_secrets")
    .select("secret").eq("session_id", sessionId).single();
  if (error) throw error;
  const secret = new Uint8Array(data.secret.match(/.{1,2}/gu).map((part: string) => Number.parseInt(part, 16)));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${sessionId}:${slot}`)));
  return base64Url(signature);
}

async function isValidCode(sessionId: string, slot: number, token: string) {
  const currentSlot = Math.floor(Date.now() / 5000);
  if (!Number.isSafeInteger(slot) || Math.abs(currentSlot - slot) > 1
    || token.length !== 43 || !/^[A-Za-z0-9_-]+$/u.test(token)) return false;
  const expected = decodeBase64Url(await sessionCode(sessionId, slot));
  return equalBytes(expected, decodeBase64Url(token));
}

async function getApprovedDevice(userId: string, deviceId: unknown) {
  if (!validUuid(deviceId)) fail("A valid device ID is required.");
  const { data, error } = await admin.from("student_devices")
    .select("id, public_key").eq("id", deviceId).eq("student_id", userId)
    .eq("status", "approved").single();
  if (error || !data) fail("This device is not approved. Ask a teacher to approve it.", 403);
  return data;
}

async function dispatch(user: { id: string; authMethods: string[] }, body: Record<string, unknown>) {
  switch (body.action) {
    case "create-course": {
      await requireRole(user.id, "teacher");
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120
        || typeof body.code !== "string" || !/^[A-Za-z0-9 -]{2,24}$/u.test(body.code.trim())) {
        fail("Provide a course name (up to 120 characters) and a 2–24 character course code.");
      }
      const { data, error } = await admin.from("courses").insert({
        name: body.name.trim(), code: body.code.trim().toUpperCase(), teacher_id: user.id,
      }).select("id, name, code").single();
      if (error?.code === "23505") fail("That course code is already in use.", 409);
      if (error) throw error;
      return { course: data };
    }
    case "enroll-student": {
      await requireRole(user.id, "teacher");
      if (!validUuid(body.course_id) || !validUuid(body.student_id)) {
        fail("A valid course ID and student user ID are required.");
      }
      const { data: course, error: courseError } = await admin.from("courses")
        .select("id, teacher_id").eq("id", body.course_id).single();
      if (courseError || !course) fail("Course not found.", 404);
      if (course.teacher_id !== user.id) fail("Only the course teacher can enroll students.", 403);
      const { data: student, error: studentError } = await admin.from("profiles")
        .select("id, role").eq("id", body.student_id).single();
      if (studentError || !student) fail("Student not found.", 404);
      if (student.role !== "student") fail("Only student accounts can be enrolled.", 409);
      const { error } = await admin.from("enrollments").insert({
        course_id: course.id, student_id: student.id,
      });
      if (error?.code === "23505") fail("This student is already enrolled.", 409);
      if (error) throw error;
      return { course_id: course.id, student_id: student.id, enrolled: true };
    }
    case "start-session": {
      if (!validUuid(body.course_id)) fail("A valid course ID is required.");
      await requireRole(user.id, "teacher");
      const { data: course, error: courseError } = await admin.from("courses")
        .select("id, teacher_id").eq("id", body.course_id).single();
      if (courseError || !course) fail("Course not found.", 404);
      if (course.teacher_id !== user.id) fail("Only the course teacher can start a session.", 403);
      const sessionId = crypto.randomUUID();
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const { error: sessionError } = await admin.rpc("start_rollcall_session", {
        p_course_id: course.id,
        p_teacher_id: user.id,
        p_session_id: sessionId,
        p_secret: Array.from(secret, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      });
      if (sessionError?.code === "23505") fail("A session is already open for this course.", 409);
      if (sessionError) throw sessionError;
      return { session_id: sessionId, is_open: true };
    }
    case "close-session": {
      if (!validUuid(body.session_id)) fail("A valid session ID is required.");
      await requireRole(user.id, "teacher");
      const { data: session, error } = await admin.from("class_sessions")
        .select("id, course_id, created_by, is_open").eq("id", body.session_id).single();
      if (error || !session) fail("Session not found.", 404);
      if (session.created_by !== user.id) fail("Only the session teacher can close it.", 403);
      if (!session.is_open) return { session_id: session.id, is_open: false };
      const { error: updateError } = await admin.from("class_sessions")
        .update({ is_open: false, closed_at: new Date().toISOString() }).eq("id", session.id);
      if (updateError) throw updateError;
      return { session_id: session.id, is_open: false };
    }
    case "get-token": {
      if (!validUuid(body.session_id)) fail("A valid session ID is required.");
      await requireRole(user.id, "teacher");
      const { data: session, error } = await admin.from("class_sessions")
        .select("id, created_by, is_open").eq("id", body.session_id).single();
      if (error || !session) fail("Session not found.", 404);
      if (session.created_by !== user.id) fail("Only the session teacher can display its QR.", 403);
      if (!session.is_open) fail("This class session is closed.", 409);
      const slot = Math.floor(Date.now() / 5000);
      const token = await sessionCode(session.id, slot);
      const payload = { v: 1, session_id: session.id, slot, token };
      return { ...payload, expires_at: (slot + 1) * 5000, qr_payload: JSON.stringify(payload) };
    }
    case "enroll-device": {
      await requireRole(user.id, "student");
      if (!user.authMethods.includes("otp")) {
        fail("Verify your account with a one-time email code before registering a new device.", 403);
      }
      if (!validUuid(body.device_id) || !body.public_key || typeof body.public_key !== "object") {
        fail("A device ID and P-256 public key are required.");
      }
      const publicKey = body.public_key as JsonWebKey;
      if (publicKey.kty !== "EC" || publicKey.crv !== "P-256"
        || typeof publicKey.x !== "string" || typeof publicKey.y !== "string"
        || publicKey.d !== undefined) fail("Submit only a P-256 public key.");
      const { data: existing, error: lookupError } = await admin.from("student_devices")
        .select("id").eq("id", body.device_id).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) fail("That device ID has already been registered.", 409);
      const { data: history, error: historyError } = await admin.from("device_change_events")
        .select("id").eq("student_id", user.id).eq("event_type", "approved")
        .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
      if (historyError) throw historyError;
      const riskFlag = history.length >= 2;
      const { error } = await admin.from("student_devices").insert({
        id: body.device_id, student_id: user.id, public_key: publicKey, risk_flag: riskFlag,
      });
      if (error) throw error;
      const { error: eventError } = await admin.from("device_change_events").insert({
        student_id: user.id, device_id: body.device_id, event_type: "enrolled",
      });
      if (eventError) throw eventError;
      return { device_id: body.device_id, status: "pending", risk_flag: riskFlag };
    }
    case "approve-device": {
      await requireRole(user.id, "teacher");
      if (!validUuid(body.device_id)) fail("A valid device ID is required.");
      const { data: device, error: deviceError } = await admin.from("student_devices")
        .select("id, student_id, status").eq("id", body.device_id).single();
      if (deviceError || !device) fail("Device not found.", 404);
      if (device.status !== "pending") fail("Only pending devices can be approved.", 409);
      const { data: taughtCourses, error: coursesError } = await admin.from("courses")
        .select("id").eq("teacher_id", user.id);
      if (coursesError) throw coursesError;
      const courseIds = taughtCourses.map((course) => course.id);
      if (!courseIds.length) fail("You are not assigned to any courses.", 403);
      const { data: enrollment, error: enrollmentError } = await admin.from("enrollments")
        .select("course_id").eq("student_id", device.student_id).in("course_id", courseIds).limit(1);
      if (enrollmentError) throw enrollmentError;
      if (!enrollment.length) fail("You can approve devices only for students enrolled in your courses.", 403);
      const { error: approvalError } = await admin.rpc("approve_rollcall_device", {
        p_device_id: device.id, p_approver_id: user.id,
      });
      if (approvalError) throw approvalError;
      return { device_id: device.id, status: "approved", previous_devices_revoked: true };
    }
    case "issue-challenge": {
      const device = await getApprovedDevice(user.id, body.device_id);
      const challenge = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const { error } = await admin.from("device_challenges").insert({
        student_id: user.id, device_id: device.id, challenge,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
      if (error) throw error;
      return { challenge, expires_in_seconds: 60 };
    }
    case "check-in": {
      const sessionId = body.session_id;
      const slot = body.slot;
      const token = body.token;
      const challenge = body.challenge;
      if (!validUuid(sessionId) || typeof slot !== "number" || !Number.isSafeInteger(slot)
        || typeof token !== "string" || token.length > 100
        || typeof challenge !== "string" || challenge.length > 100
        || typeof body.signature !== "string" || body.signature.length > 200) {
        fail("The QR payload or signed device challenge is incomplete.");
      }
      const device = await getApprovedDevice(user.id, body.device_id);
      const { data: challengeRow, error: challengeError } = await admin.from("device_challenges")
        .select("id, expires_at").eq("challenge", challenge).eq("student_id", user.id)
        .eq("device_id", device.id).single();
      if (challengeError || !challengeRow || Date.parse(challengeRow.expires_at) <= Date.now()) {
        fail("The device challenge expired or was already used. Scan again.", 409);
      }
      const signedMessage = `rollcall-v1\n${challenge}\n${sessionId}\n${slot}\n${token}`;
      let publicKey: CryptoKey;
      try {
        publicKey = await crypto.subtle.importKey("jwk", device.public_key as JsonWebKey,
          { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      } catch {
        fail("The registered device key is invalid. Re-enroll this device.", 403);
      }
      let signature: Uint8Array;
      try {
        signature = decodeBase64Url(body.signature);
      } catch {
        fail("The device signature is malformed.");
      }
      if (signature.length !== 64) fail("The device signature must use P-256 IEEE-P1363 format.");
      const validSignature = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" }, publicKey!, signature!, encoder.encode(signedMessage),
      );
      if (!validSignature) fail("The device signature could not be verified.", 403);
      const { data: session, error: sessionError } = await admin.from("class_sessions")
        .select("id, course_id, is_open").eq("id", sessionId).single();
      if (sessionError || !session) fail("Session not found.", 404);
      if (!session.is_open) fail("This class session is closed.", 409);
      if (!(await isValidCode(sessionId, slot, token))) {
        fail("That QR code expired or is invalid. Scan the currently displayed code.", 409);
      }
      const { error: consumeError } = await admin.from("device_challenges")
        .delete().eq("id", challengeRow.id).eq("student_id", user.id);
      if (consumeError) throw consumeError;
      const { error: attendanceError } = await admin.rpc("record_rollcall_attendance", {
        p_session_id: session.id,
        p_student_id: user.id,
        p_device_id: device.id,
        p_token_slot: slot,
      });
      if (attendanceError?.code === "23505") fail("You have already checked in to this class session.", 409);
      if (attendanceError?.code === "42501") fail("You are not enrolled or your device is no longer approved.", 403);
      if (attendanceError?.code === "P0001") fail("This class session is closed.", 409);
      if (attendanceError?.code === "P0002") fail("Session not found.", 404);
      if (attendanceError) throw attendanceError;
      return { session_id: session.id, course_id: session.course_id, checked_in: true };
    }
    default:
      fail("Unknown action.");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Use POST for this endpoint." }, 405);
  try {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 16384) fail("Request body is too large.", 413);
    const user = await requireUser(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      fail("Request body must be valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("A JSON object is required.");
    return response(await dispatch(user, body as Record<string, unknown>));
  } catch (error) {
    const candidateStatus = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status) : 500;
    const status = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
      ? candidateStatus : 500;
    if (status >= 500) console.error("Rollcall Edge Function failed.", error);
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return response({ error: status >= 500 ? "The request could not be completed." : message }, status);
  }
});
