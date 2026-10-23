(function () {
  "use strict";

  const STORAGE_KEY = "rollcall-demo-v1";
  const TARGET_PERCENT = 75;
  const seedCourses = [
    { id: "math", name: "Discrete Mathematics", code: "CS 204", icon: "∑", tone: "sage", attended: 18, held: 22, activeCode: "ROLL-4K8P", open: true },
    { id: "physics", name: "Artificial Intelligence", code: "AI 301", icon: "✳", tone: "peach", attended: 15, held: 20, activeCode: "ROLL-7M2Q", open: true },
    { id: "data", name: "Data Structures", code: "CS 206", icon: "⌘", tone: "lilac", attended: 21, held: 24, activeCode: "ROLL-9T5D", open: true },
    { id: "ml", name: "Machine Learning", code: "ML 302", icon: "◌", tone: "blue", attended: 13, held: 20, activeCode: "ROLL-3N8V", open: true }
  ];
  const classGroups = [
    { id: "y1-cse-a", qrId: "Y1-CSEA", year: "Year 1", branch: "CSE", section: "A", subjectIds: ["math", "physics"] },
    { id: "y2-cse-a", qrId: "Y2-CSEA", year: "Year 2", branch: "CSE", section: "A", subjectIds: ["data", "ml"] },
    { id: "y2-ai-b", qrId: "Y2-AIB", year: "Year 2", branch: "AI", section: "B", subjectIds: ["physics", "ml"] },
    { id: "y3-cse-b", qrId: "Y3-CSEB", year: "Year 3", branch: "CSE", section: "B", subjectIds: ["math", "data"] }
  ];
  const sampleTimetable = [
    { day: "Monday", time: "9:00–10:00", courseId: "math", room: "Room 204" },
    { day: "Monday", time: "11:00–12:00", courseId: "physics", room: "AI Lab" },
    { day: "Tuesday", time: "10:00–11:00", courseId: "ml", room: "Room 310" },
    { day: "Wednesday", time: "9:00–10:00", courseId: "data", room: "Lab 2" },
    { day: "Thursday", time: "11:00–12:00", courseId: "physics", room: "AI Lab" },
    { day: "Friday", time: "10:00–11:00", courseId: "ml", room: "Room 310" }
  ];
  const demoStudents = [
    { id: "STU-1042", name: "Aanya Sharma", attendance: 82, deviceSignal: "1 device · usual pattern", needsInPersonCheck: false },
    { id: "STU-1087", name: "Kabir Mehta", attendance: 68, deviceSignal: "3 devices · demo signal", needsInPersonCheck: true },
    { id: "STU-1125", name: "Meera Nair", attendance: 91, deviceSignal: "1 device · usual pattern", needsInPersonCheck: false },
    { id: "STU-1193", name: "Arjun Rao", attendance: 74, deviceSignal: "Repeat sign-ins · demo", needsInPersonCheck: true },
    { id: "STU-1238", name: "Diya Kapoor", attendance: 77, deviceSignal: "1 device · usual pattern", needsInPersonCheck: false }
  ];

  const $ = (selector) => document.querySelector(selector);
  const state = loadState();
  const absenceRequests = [];
  let selectedTeacherGroupId = classGroups[0].id;
  let selectedTeacherCourseId = classGroups[0].subjectIds[0];
  let activeRole = "student";
  let cameraStream = null;
  let scanTimer = null;
  let scanInProgress = false;
  let teacherCodeTimer = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.courses) && Array.isArray(saved.history)) {
        const signedInCourseId = saved.signedInCourseId || null;
        return {
          courses: mergeCourses(saved.courses),
          history: saved.history,
          checkedInCodes: Array.isArray(saved.checkedInCodes) ? saved.checkedInCodes : [],
          signedInCourseId,
          signedInGroupId: saved.signedInGroupId || (signedInCourseId ? classGroups.find((group) => group.subjectIds.includes(signedInCourseId))?.id : null) || null,
          demoAttendance: saved.demoAttendance && typeof saved.demoAttendance === "object" ? saved.demoAttendance : {},
          classSessions: saved.classSessions && typeof saved.classSessions === "object" ? saved.classSessions : {},
          approvedAbsenceKeys: Array.isArray(saved.approvedAbsenceKeys) ? saved.approvedAbsenceKeys : []
        };
      }
    } catch (error) {
      console.error("Could not load Rollcall demo data.", error);
      reportStorageError("Saved demo data couldn't be loaded. Sample data is shown instead.");
    }
    return { courses: seedCourses.map((course) => ({ ...course })), history: [], checkedInCodes: [], signedInCourseId: null, signedInGroupId: null, demoAttendance: {}, classSessions: {}, approvedAbsenceKeys: [] };
  }

  function mergeCourses(saved) {
    return seedCourses.map((seed) => {
      const savedCourse = saved.find((course) => course.id === seed.id);
      return savedCourse ? { ...seed, ...savedCourse, name: seed.name, code: seed.code, icon: seed.icon, tone: seed.tone } : { ...seed };
    });
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save Rollcall demo data.", error);
      reportStorageError("This browser couldn't save your changes. They'll be lost when you refresh.");
    }
  }

  function reportStorageError(message) {
    const notice = $("#storage-warning");
    notice.textContent = message;
    notice.classList.remove("is-hidden");
  }

  function attendancePercent(course) {
    return course.held ? Math.round((course.attended / course.held) * 100) : 0;
  }

  function classesNeeded(course) {
    return Math.max(0, 3 * course.held - 4 * course.attended);
  }

  function classesCanMiss(course) {
    return Math.max(0, Math.floor((4 * course.attended - 3 * course.held) / 3));
  }

  function minimumForNextClasses(course, upcomingClasses = 4) {
    return Math.min(upcomingClasses, Math.max(0, Math.ceil((3 * (course.held + upcomingClasses) - 4 * course.attended) / 4)));
  }

  function isBelowTarget(course) {
    return course.held > 0 && course.attended / course.held < TARGET_PERCENT / 100;
  }

  function classSessionKey(groupId, courseId) {
    return `${groupId}:${courseId}`;
  }

  function getClassSession(group, course) {
    const key = classSessionKey(group.id, course.id);
    let session = state.classSessions[key];
    if (!session || typeof session.open !== "boolean" || typeof session.activeCode !== "string") {
      session = {
        open: course.open,
        activeCode: `${course.activeCode}:${group.id}`
      };
      state.classSessions[key] = session;
    }
    return session;
  }

  function getGroup(groupId) {
    return classGroups.find((group) => group.id === groupId);
  }

  function getCourse(courseId) {
    return state.courses.find((course) => course.id === courseId);
  }

  function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `inline-message${type ? ` ${type}` : ""}`;
  }

  function render() {
    renderDate();
    renderStudent();
    renderTeacher();
    renderCourseOptions();
    renderAbsenceFormOptions();
    renderSignedInState();
    renderStudentAbsenceRequests();
  }

  function renderDate() {
    const now = new Date();
    $("#today-label").textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    $("#teacher-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const eyebrow = $(".welcome-row .eyebrow");
    if (eyebrow && eyebrow.textContent.startsWith("MONDAY")) {
      eyebrow.textContent = `${now.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase()}, YOUR ATTENDANCE LOOKS GOOD`;
    }
  }

  function renderStudent() {
    const attended = state.courses.reduce((sum, course) => sum + course.attended, 0);
    const held = state.courses.reduce((sum, course) => sum + course.held, 0);
    const missed = held - attended;
    const percent = held ? Math.round((attended / held) * 100) : 0;
    const overall = { attended, held };
    const needed = classesNeeded(overall);
    const lowAttendanceCourses = state.courses.filter(isBelowTarget).sort((left, right) => left.attended / left.held - right.attended / right.held);
    $("#overall-percent").textContent = `${percent}%`;
    $("#overall-status").textContent = isBelowTarget(overall) ? "Needs a little care" : "On track";
    $("#overall-status").classList.toggle("behind", isBelowTarget(overall));
    $("#overall-progress").setAttribute("aria-valuenow", String(percent));
    $("#overall-progress-fill").style.width = `${Math.min(100, percent)}%`;
    $("#attended-total").textContent = String(attended);
    $("#missed-total").textContent = String(missed);
    $("#overall-note").textContent = needed
      ? `Attend your next ${needed} classes in a row to bring your overall attendance back to ${TARGET_PERCENT}%.`
      : `You're meeting the ${TARGET_PERCENT}% overall target. Keep showing up!`;
    renderAttendanceNotifications(lowAttendanceCourses);
    renderAttendancePlan();
    renderTimetable();
    renderAbsenceFormOptions();
    $("#course-grid").innerHTML = state.courses.map((course) => {
      const coursePercent = attendancePercent(course);
      const courseNeeded = classesNeeded(course);
      const courseIsLow = isBelowTarget(course);
      return `<article class="card course-card">
        <div class="course-head">
          <span class="course-icon ${escapeHtml(course.tone)}" aria-hidden="true">${escapeHtml(course.icon)}</span>
          <div><p class="course-name">${escapeHtml(course.name)}</p><span class="course-detail">${escapeHtml(course.code)} · ${course.held} classes held</span></div>
          <span class="course-percent${courseIsLow ? " behind" : ""}">${coursePercent}%</span>
        </div>
        <div class="mini-progress" role="progressbar" aria-label="${escapeHtml(course.name)} attendance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${coursePercent}"><span style="width:${Math.min(100, coursePercent)}%"></span></div>
        <div class="course-stats"><span><strong>${course.attended}</strong> attended</span><span><strong>${course.held - course.attended}</strong> missed</span><span><strong>${course.held}</strong> total</span></div>
        <p class="needed-note${courseIsLow ? " behind" : ""}">${courseIsLow ? `Action needed: attend the next ${courseNeeded} classes to recover to 75%` : `✓ On track · can miss ${classesCanMiss(course)} more ${classesCanMiss(course) === 1 ? "class" : "classes"} and stay at 75%`}</p>
      </article>`;
    }).join("");
  }

  function renderAttendanceNotifications(lowAttendanceCourses) {
    const section = $("#notifications-section");
    const list = $("#notification-list");
    const count = $("#notification-count");
    section.classList.toggle("has-alerts", lowAttendanceCourses.length > 0);
    count.textContent = String(lowAttendanceCourses.length);
    if (!lowAttendanceCourses.length) {
      list.innerHTML = `<article class="notification-empty"><span class="notification-check" aria-hidden="true">✓</span><div><strong>You're all caught up</strong><p>No subjects are below the ${TARGET_PERCENT}% attendance target.</p></div></article>`;
      return;
    }
    list.innerHTML = lowAttendanceCourses.map((course) => {
      const needed = classesNeeded(course);
      return `<article class="notification-item">
        <span class="notification-icon" aria-hidden="true">!</span>
        <div class="notification-copy"><strong>${escapeHtml(course.name)} needs attention</strong><p>Attendance is ${attendancePercent(course)}%. Attend your next ${needed} ${needed === 1 ? "class" : "classes"} consecutively to return to ${TARGET_PERCENT}%.</p></div>
        <span class="notification-course">${escapeHtml(course.code)}</span>
      </article>`;
    }).join("");
  }

  function renderAttendancePlan() {
    $("#attendance-plan").innerHTML = state.courses.map((course) => {
      const low = isBelowTarget(course);
      return `<li class="plan-row">
        <span class="plan-dot ${escapeHtml(course.tone)}" aria-hidden="true"></span>
        <span class="plan-course">${escapeHtml(course.name)}</span>
        <span class="plan-guidance${low ? " behind" : ""}">${low ? `Attend ${classesNeeded(course)} straight to recover` : `Attend ${minimumForNextClasses(course)} of next 4`}</span>
      </li>`;
    }).join("");
  }

  function renderTimetable() {
    $("#timetable-list").innerHTML = sampleTimetable.map((entry) => {
      const course = state.courses.find((item) => item.id === entry.courseId);
      if (!course) return "";
      return `<li class="timetable-row">
        <span class="timetable-day">${escapeHtml(entry.day.slice(0, 3))}</span>
        <span class="timetable-time">${escapeHtml(entry.time)}</span>
        <span class="timetable-course"><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(entry.room)}</small></span>
        <span class="course-icon timetable-icon ${escapeHtml(course.tone)}" aria-hidden="true">${escapeHtml(course.icon)}</span>
      </li>`;
    }).join("");
  }

  function renderTeacher() {
    const groupSelect = $("#teacher-group-select");
    const subjectSelect = $("#teacher-course-select");
    if (!groupSelect || !subjectSelect) return;
    groupSelect.innerHTML = classGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.year)} · ${escapeHtml(group.branch)} · Section ${escapeHtml(group.section)}</option>`).join("");
    if (!getGroup(selectedTeacherGroupId)) selectedTeacherGroupId = classGroups[0]?.id || "";
    groupSelect.value = selectedTeacherGroupId;
    const group = getGroup(selectedTeacherGroupId);
    if (!group) {
      $("#class-count").textContent = "No classes available";
      $("#teacher-course-list").innerHTML = `<div class="card empty-courses">No subjects are available for the teacher demo.</div>`;
      renderTeacherTracker(null);
      renderTeacherAbsenceRequests(null, null);
      return;
    }
    const groupCourses = group.subjectIds.map(getCourse).filter(Boolean);
    subjectSelect.innerHTML = groupCourses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)} · ${escapeHtml(course.code)}</option>`).join("");
    if (!group.subjectIds.includes(selectedTeacherCourseId)) selectedTeacherCourseId = group.subjectIds[0];
    subjectSelect.value = selectedTeacherCourseId;
    const course = getCourse(selectedTeacherCourseId);
    if (!course) {
      $("#class-count").textContent = "No subjects available";
      $("#teacher-course-list").innerHTML = `<div class="card empty-courses">No subjects are available for this class.</div>`;
      renderTeacherTracker(null);
      renderTeacherAbsenceRequests(group, null);
      return;
    }
    const key = classSessionKey(group.id, course.id);
    const session = getClassSession(group, course);
    const checkInCount = (state.demoAttendance[key] || []).length;
    $("#class-count").textContent = `${checkInCount} demo check-ins`;
    const status = session.open ? "Open for check-in" : "Session closed";
    $("#teacher-course-list").innerHTML = `<article class="card teacher-course">
        <div class="course-head">
          <span class="course-icon ${escapeHtml(course.tone)}" aria-hidden="true">${escapeHtml(course.icon)}</span>
          <div><p class="course-name">${escapeHtml(course.name)}</p><span class="course-detail">${escapeHtml(group.year)} · ${escapeHtml(group.branch)} · Section ${escapeHtml(group.section)}</span></div>
        </div>
        <span class="session-status${session.open ? " open" : ""}">${status}</span>
        ${session.open ? `<div class="teacher-qr"><canvas width="174" height="174" data-qr="${escapeHtml(key)}" aria-label="Live QR code for ${escapeHtml(group.year)} ${escapeHtml(group.branch)} Section ${escapeHtml(group.section)}, ${escapeHtml(course.name)}"></canvas></div>` : `<div class="teacher-qr is-disabled" aria-hidden="true">Closed</div>`}
        <div class="session-info">
          <span class="session-code-label">LIVE CODE · REFRESHES</span>
          <span class="session-code" data-live-code="${escapeHtml(key)}">${session.open ? escapeHtml(currentCode(session)) : "— — — — —"}</span>
          ${session.open ? `<div class="session-countdown" data-countdown="${escapeHtml(key)}"></div>` : ""}
          <div class="session-count">${checkInCount} demo students checked in</div>
        </div>
        <div class="teacher-actions">
          ${session.open ? `<button class="button copy-button" data-copy="${escapeHtml(key)}" type="button">Copy code</button><button class="button session-button close-session" data-session="${escapeHtml(key)}" type="button">Close session</button>` : `<button class="button button-primary session-button" data-session="${escapeHtml(key)}" type="button">Open session</button>`}
        </div>
      </article>`;
    renderTeacherQrCodes();
    refreshTeacherCodes();
    document.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => toggleSession(button.dataset.session)));
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => copyCode(button.dataset.copy)));
    renderTeacherTracker(group, course, session);
    renderTeacherAbsenceRequests(group, course);
  }

  function renderTeacherTracker(group, course, session) {
    if (!group || !course || !session) {
      $("#tracker-count").textContent = "0 checked in";
      $("#tracker-rows").innerHTML = "";
      return;
    }
    const key = classSessionKey(group.id, course.id);
    const checkedIn = new Set(state.demoAttendance[key] || []);
    $("#tracker-count").textContent = `${checkedIn.size} of ${demoStudents.length} checked in`;
    $("#tracker-rows").innerHTML = demoStudents.map((student) => {
      const isPresent = checkedIn.has(student.id);
      return `<tr>
        <td><span class="student-name">${escapeHtml(student.name)}</span></td>
        <td class="student-id">${escapeHtml(student.id)}</td>
        <td><span class="student-attendance${student.attendance < TARGET_PERCENT ? " behind" : ""}">${student.attendance}%</span></td>
        <td><span class="student-presence${isPresent ? " present" : ""}">${isPresent ? "Checked in" : "Not yet"}</span></td>
        <td>${escapeHtml(student.deviceSignal)}</td>
        <td><span class="review-status${student.needsInPersonCheck ? " recommended" : ""}">${student.needsInPersonCheck ? "In-person check suggested" : "No check indicated"}</span></td>
        <td><button class="tracker-action${isPresent ? " checked" : ""}" type="button" data-demo-checkin="${escapeHtml(student.id)}" ${isPresent || !session.open ? "disabled" : ""}>${isPresent ? "Present ✓" : "Demo check-in"}</button></td>
      </tr>`;
    }).join("");
    document.querySelectorAll("[data-demo-checkin]").forEach((button) => button.addEventListener("click", () => {
      const studentId = button.dataset.demoCheckin;
      const attendance = state.demoAttendance[key] || [];
      if (!session.open || attendance.includes(studentId)) return;
      state.demoAttendance[key] = [...attendance, studentId];
      saveState();
      renderTeacher();
    }));
  }

  function todayISO() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  function renderAbsenceFormOptions() {
    const groupSelect = $("#absence-group");
    const courseSelect = $("#absence-course");
    if (!groupSelect || !courseSelect) return;
    const selectedGroupId = groupSelect.value || state.signedInGroupId || $("#student-group-select").value || classGroups[0].id;
    groupSelect.innerHTML = classGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.year)} · ${escapeHtml(group.branch)} · Section ${escapeHtml(group.section)}</option>`).join("");
    const group = getGroup(selectedGroupId) || classGroups[0];
    groupSelect.value = group.id;
    const selectedCourseId = courseSelect.value;
    const groupCourses = group.subjectIds.map(getCourse).filter(Boolean);
    courseSelect.innerHTML = groupCourses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)} · ${escapeHtml(course.code)}</option>`).join("");
    courseSelect.value = groupCourses.some((course) => course.id === selectedCourseId) ? selectedCourseId : groupCourses[0]?.id || "";
    $("#absence-date").max = todayISO();
  }

  function renderStudentAbsenceRequests() {
    const list = $("#student-absence-requests");
    if (!list) return;
    if (!absenceRequests.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = `<h3>Your requests</h3><ul class="absence-request-list">${absenceRequests.map((request) => `<li class="absence-request-item">
      <div><strong>${escapeHtml(request.reason)} · ${escapeHtml(request.date)}</strong><span>${escapeHtml(getGroup(request.groupId)?.year || "")} · ${escapeHtml(getCourse(request.courseId)?.name || "")}</span></div>
      <span class="request-status ${escapeHtml(request.status)}">${escapeHtml(request.status === "approved" ? "Approved · demo credit added" : request.status === "declined" ? "Declined" : "Waiting for teacher")}</span>
    </li>`).join("")}</ul>`;
  }

  function renderTeacherAbsenceRequests(group, course) {
    const list = $("#teacher-absence-list");
    const count = $("#absence-request-count");
    if (!list || !count) return;
    const visibleRequests = group && course
      ? absenceRequests.filter((request) => request.groupId === group.id && request.courseId === course.id)
      : [];
    const pending = visibleRequests.filter((request) => request.status === "pending").length;
    count.textContent = `${pending} pending`;
    if (!visibleRequests.length) {
      list.innerHTML = `<p class="absence-empty">No requests for this selected class yet.</p>`;
      return;
    }
    list.innerHTML = visibleRequests.map((request) => {
      const alreadyCredited = state.approvedAbsenceKeys.includes(absenceApprovalKey(request));
      const statusText = request.status === "approved" || alreadyCredited ? "Approved · demo credit recorded" : request.status === "declined" ? "Declined" : "Pending review";
      const controls = request.status === "pending" && !alreadyCredited
        ? `<div class="absence-review-actions"><button class="button absence-approve" type="button" data-absence-review="approve" data-request-id="${escapeHtml(request.id)}">Approve · demo credit</button><button class="button absence-decline" type="button" data-absence-review="decline" data-request-id="${escapeHtml(request.id)}">Decline</button></div>`
        : "";
      return `<article class="absence-review-card">
        <div class="absence-review-top"><div><strong>Aanya Sharma · ${escapeHtml(request.reason)}</strong><span>${escapeHtml(request.date)} · ${escapeHtml(getCourse(request.courseId)?.name || "")}</span></div><span class="request-status ${request.status === "pending" && alreadyCredited ? "approved" : escapeHtml(request.status)}">${statusText}</span></div>
        <p>Supporting document attachment · preview only</p>
        ${controls}
      </article>`;
    }).join("");
    list.querySelectorAll("[data-absence-review]").forEach((button) => button.addEventListener("click", () => reviewAbsenceRequest(button.dataset.requestId, button.dataset.absenceReview)));
  }

  function absenceApprovalKey(request) {
    return `${request.groupId}:${request.courseId}:STU-1042:${request.date}`;
  }

  function reviewAbsenceRequest(requestId, decision) {
    const request = absenceRequests.find((item) => item.id === requestId);
    if (!request || request.status !== "pending") return;
    if (decision === "approve") {
      const key = absenceApprovalKey(request);
      if (state.approvedAbsenceKeys.includes(key)) {
        request.status = "approved";
      } else {
        const course = getCourse(request.courseId);
        if (!course) {
          console.error("Cannot approve absence request: the selected subject no longer exists.");
          return;
        }
        course.attended += 1;
        state.approvedAbsenceKeys.push(key);
        request.status = "approved";
        saveState();
      }
    } else if (decision === "decline") {
      request.status = "declined";
    } else {
      return;
    }
    render();
  }

  function submitAbsenceRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = $("#absence-document");
    const file = fileInput.files[0];
    const date = $("#absence-date").value;
    if (!file) {
      showMessage($("#absence-form-message"), "Choose a fictional sample document for this demo request.", "error");
      return;
    }
    const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
    const allowedExtensions = /\.(pdf|jpe?g|png)$/i;
    if ((file.type && !allowedMimeTypes.includes(file.type)) || !allowedExtensions.test(file.name) || file.size > 10 * 1024 * 1024) {
      showMessage($("#absence-form-message"), "Choose a PDF, JPG, or PNG under 10 MB. The file will not be uploaded.", "error");
      return;
    }
    if (!date || date > todayISO()) {
      showMessage($("#absence-form-message"), "Choose a class date today or earlier.", "error");
      return;
    }
    const request = {
      id: `absence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupId: $("#absence-group").value,
      courseId: $("#absence-course").value,
      date,
      reason: $("#absence-reason").value,
      status: "pending"
    };
    if (!request.reason || !getGroup(request.groupId)?.subjectIds.includes(request.courseId)) {
      showMessage($("#absence-form-message"), "Choose a valid class, subject, and reason.", "error");
      return;
    }
    if (state.approvedAbsenceKeys.includes(absenceApprovalKey(request)) || absenceRequests.some((item) => absenceApprovalKey(item) === absenceApprovalKey(request))) {
      showMessage($("#absence-form-message"), "A request or attendance credit already exists for that student, class, subject, and date.", "error");
      return;
    }
    absenceRequests.push(request);
    form.reset();
    $("#absence-file-hint").textContent = "Supporting document attachment · preview only";
    renderAbsenceFormOptions();
    renderStudentAbsenceRequests();
    renderTeacher();
    showMessage($("#absence-form-message"), "Demo request sent. The selected file stayed on this device and is not available to the teacher.", "success");
  }

  function renderTeacherQrCodes() {
    document.querySelectorAll("canvas[data-qr]").forEach((canvas) => {
      const [groupId, courseId] = canvas.dataset.qr.split(":");
      const group = getGroup(groupId);
      const course = getCourse(courseId);
      if (!group || !course) return;
      const session = getClassSession(group, course);
      const code = currentCode(session);
      const matrix = createQrMatrix(`${group.qrId}:${course.id.toUpperCase()}:${code}`);
      const context = canvas.getContext("2d");
      if (!context) {
        console.error("Canvas is unavailable; the fallback class code is still available.");
        return;
      }
      const cellSize = canvas.width / (matrix.length + 8);
      context.fillStyle = "#fffefa";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#27352a";
      matrix.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) context.fillRect((x + 4) * cellSize, (y + 4) * cellSize, cellSize, cellSize);
      }));
    });
  }

  function currentCode(course, timestamp = Date.now()) {
    const windowNumber = Math.floor(timestamp / 30000);
    let hash = 2166136261;
    for (const character of `${course.activeCode}:${windowNumber}`) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    let value = hash >>> 0;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < 4; index++) {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      code += alphabet[(value >>> 0) % alphabet.length];
    }
    return `ROLL-${code}`;
  }

  function secondsUntilCodeRefresh(timestamp = Date.now()) {
    return Math.ceil((30000 - (timestamp % 30000)) / 1000);
  }

  function refreshTeacherCodes() {
    const timestamp = Date.now();
    let qrNeedsRefresh = false;
    const canvas = $("canvas[data-qr]");
    if (canvas) {
      const [groupId, courseId] = canvas.dataset.qr.split(":");
      const group = getGroup(groupId);
      const course = getCourse(courseId);
      if (group && course) {
        const session = getClassSession(group, course);
        if (session.open) {
          const key = classSessionKey(group.id, course.id);
          const liveCode = currentCode(session, timestamp);
          const codeElement = document.querySelector(`[data-live-code="${key}"]`);
          const countdownElement = document.querySelector(`[data-countdown="${key}"]`);
          if (codeElement && codeElement.textContent !== liveCode) {
            codeElement.textContent = liveCode;
            qrNeedsRefresh = true;
          }
          if (countdownElement) countdownElement.textContent = `New code in ${secondsUntilCodeRefresh(timestamp)}s`;
        }
      }
    }
    if (qrNeedsRefresh) renderTeacherQrCodes();
  }

  function createQrMatrix(text) {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    if (text.length > 25 || Array.from(text).some((character) => !alphabet.includes(character))) {
      throw new Error("Attendance codes must use up to 25 QR alphanumeric characters.");
    }
    const bits = [];
    const appendBits = (value, count) => {
      for (let index = count - 1; index >= 0; index--) bits.push((value >>> index) & 1);
    };
    appendBits(0b0010, 4);
    appendBits(text.length, 9);
    for (let index = 0; index < text.length; index += 2) {
      if (index + 1 < text.length) appendBits(alphabet.indexOf(text[index]) * 45 + alphabet.indexOf(text[index + 1]), 11);
      else appendBits(alphabet.indexOf(text[index]), 6);
    }
    const dataCapacity = 19 * 8;
    for (let index = 0; index < Math.min(4, dataCapacity - bits.length); index++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
    }
    for (let pad = 0; data.length < 19; pad++) data.push(pad % 2 ? 0x11 : 0xec);
    const codewords = data.concat(reedSolomonRemainder(data, 7));
    const size = 21;
    const matrix = Array.from({ length: size }, () => Array(size).fill(null));
    const setFinder = (centerX, centerY) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = centerX + dx;
          const y = centerY + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          matrix[y][x] = distance !== 2 && distance <= 3;
        }
      }
    };
    setFinder(3, 3);
    setFinder(size - 4, 3);
    setFinder(3, size - 4);
    for (let index = 8; index < size - 8; index++) {
      matrix[6][index] = index % 2 === 0;
      matrix[index][6] = index % 2 === 0;
    }
    const formatData = 0b01000;
    let remainder = formatData;
    for (let index = 0; index < 10; index++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const formatBits = ((formatData << 10) | remainder) ^ 0x5412;
    const bitAt = (index) => ((formatBits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index++) matrix[index][8] = bitAt(index);
    matrix[7][8] = bitAt(6);
    matrix[8][8] = bitAt(7);
    matrix[8][7] = bitAt(8);
    for (let index = 9; index < 15; index++) matrix[8][14 - index] = bitAt(index);
    for (let index = 0; index < 8; index++) matrix[8][size - 1 - index] = bitAt(index);
    for (let index = 8; index < 15; index++) matrix[size - 15 + index][8] = bitAt(index);
    matrix[size - 8][8] = true;
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        const y = upward ? size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset++) {
          const x = right - offset;
          if (matrix[y][x] !== null) continue;
          const bit = bitIndex < codewords.length * 8
            ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0
            : false;
          matrix[y][x] = bit !== ((x + y) % 2 === 0);
          bitIndex++;
        }
      }
      upward = !upward;
    }
    return matrix;
  }

  function reedSolomonRemainder(data, degree) {
    const multiply = (left, right) => {
      let product = 0;
      for (let bit = 7; bit >= 0; bit--) {
        product = (product << 1) ^ ((product >>> 7) * 0x11d);
        product ^= ((right >>> bit) & 1) * left;
      }
      return product;
    };
    let generator = [1];
    for (let index = 0; index < degree; index++) {
      const next = Array(generator.length + 1).fill(0);
      generator.forEach((coefficient, position) => {
        next[position] ^= coefficient;
        next[position + 1] ^= multiply(coefficient, 1 << index);
      });
      generator = next;
    }
    const remainder = [...data, ...Array(degree).fill(0)];
    for (let index = 0; index < data.length; index++) {
      const factor = remainder[index];
      if (factor) generator.forEach((coefficient, offset) => {
        remainder[index + offset] ^= multiply(coefficient, factor);
      });
    }
    return remainder.slice(data.length);
  }

  function renderCourseOptions() {
    const groupSelect = $("#student-group-select");
    const select = $("#course-select");
    if (!groupSelect || !select) return;
    const currentGroupId = groupSelect.value;
    groupSelect.innerHTML = classGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.year)} · ${escapeHtml(group.branch)} · Section ${escapeHtml(group.section)}</option>`).join("");
    const groupId = state.signedInGroupId || (getGroup(currentGroupId) ? currentGroupId : classGroups[0]?.id);
    groupSelect.value = groupId;
    const group = getGroup(groupId);
    const currentCourseId = select.value;
    const groupCourses = group ? group.subjectIds.map(getCourse).filter(Boolean) : [];
    select.innerHTML = groupCourses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)} (${escapeHtml(course.code)})</option>`).join("");
    select.value = state.signedInCourseId || (groupCourses.some((course) => course.id === currentCourseId) ? currentCourseId : groupCourses[0]?.id || "");
  }

  function renderSignedInState() {
    const signedInCourse = state.courses.find((course) => course.id === state.signedInCourseId);
    const signInButton = $("#sign-in-button");
    const signOutButton = $("#sign-out-button");
    if (signedInCourse) {
      $("#student-group-select").value = state.signedInGroupId;
      $("#course-select").value = signedInCourse.id;
      $("#student-group-select").disabled = true;
      $("#course-select").disabled = true;
      $("#fallback-code").disabled = true;
      signInButton.classList.add("is-hidden");
      signOutButton.classList.remove("is-hidden");
      showMessage($("#form-message"), `You're signed in to ${signedInCourse.name}. Remember to sign out when class ends.`, "success");
    } else {
      $("#student-group-select").disabled = false;
      $("#course-select").disabled = false;
      $("#fallback-code").disabled = false;
      signInButton.classList.remove("is-hidden");
      signOutButton.classList.add("is-hidden");
      if ($("#form-message").classList.contains("success")) showMessage($("#form-message"), "", "");
    }
  }

  function toggleSession(courseId) {
    const [groupId, selectedCourseId] = courseId.split(":");
    const group = getGroup(groupId);
    const course = getCourse(selectedCourseId);
    if (!group || !course || !group.subjectIds.includes(course.id)) return;
    const key = classSessionKey(group.id, course.id);
    const session = getClassSession(group, course);
    session.open = !session.open;
    if (session.open) {
      session.activeCode = `ROLL-${randomCode()}`;
      state.demoAttendance[key] = [];
    }
    saveState();
    render();
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const values = new Uint32Array(4);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * alphabet.length); });
    return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  }

  async function copyCode(courseId) {
    const [groupId, selectedCourseId] = courseId.split(":");
    const group = getGroup(groupId);
    const course = getCourse(selectedCourseId);
    if (!group || !course || !group.subjectIds.includes(course.id)) return;
    const session = getClassSession(group, course);
    try {
      await navigator.clipboard.writeText(currentCode(session));
      showMessage($("#teacher-message"), "Live code copied. It refreshes in 30 seconds.", "success");
    } catch (error) {
      console.error("Could not copy the class code.", error);
      showMessage($("#teacher-message"), "Copy unavailable — share the live code shown on screen.", "error");
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function setRole(role) {
    activeRole = role;
    stopScanner();
    $("#student-view").classList.toggle("is-hidden", role !== "student");
    $("#checkin-view").classList.add("is-hidden");
    $("#teacher-view").classList.toggle("is-hidden", role !== "teacher");
    document.querySelectorAll(".role-button").forEach((button) => {
      const selected = button.dataset.role === role;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $(".avatar").setAttribute("aria-label", role === "student" ? "Student profile" : "Teacher profile");
  }

  function openCheckin() {
    activeRole = "checkin";
    $("#student-view").classList.add("is-hidden");
    $("#teacher-view").classList.add("is-hidden");
    $("#checkin-view").classList.remove("is-hidden");
    $("#course-select").focus();
    renderSignedInState();
  }

  function signIn(event) {
    event.preventDefault();
    const group = getGroup($("#student-group-select").value);
    const courseId = $("#course-select").value;
    const course = getCourse(courseId);
    const session = group && course && group.subjectIds.includes(course.id) ? getClassSession(group, course) : null;
    const enteredCode = $("#fallback-code").value.trim().toUpperCase();
    if (!group || !course || !session || !enteredCode) {
      showMessage($("#form-message"), "Choose a class and enter its code.", "error");
      return;
    }
    if (!session.open) {
      showMessage($("#form-message"), "This class session is closed. Ask your teacher to open it.", "error");
      return;
    }
    if (enteredCode !== currentCode(session)) {
      showMessage($("#form-message"), "That live code has expired or doesn't match. Use the code currently on screen and try again.", "error");
      return;
    }
    const sessionKey = `${group.id}:${course.id}:${session.activeCode}`;
    if (state.checkedInCodes.includes(sessionKey)) {
      showMessage($("#form-message"), "You've already checked in to this class session.", "error");
      return;
    }
    if (state.signedInCourseId) {
      showMessage($("#form-message"), "Sign out of your current class before signing in to another.", "error");
      return;
    }
    course.attended += 1;
    course.held += 1;
    state.checkedInCodes.push(sessionKey);
    const attendanceKey = classSessionKey(group.id, course.id);
    const demoAttendance = state.demoAttendance[attendanceKey] || [];
    if (!demoAttendance.includes("STU-1042")) state.demoAttendance[attendanceKey] = [...demoAttendance, "STU-1042"];
    state.signedInCourseId = course.id;
    state.signedInGroupId = group.id;
    state.history.push({ groupId: group.id, courseId: course.id, action: "signed-in", at: new Date().toISOString() });
    saveState();
    render();
  }

  function signOut() {
    const course = state.courses.find((item) => item.id === state.signedInCourseId);
    if (!course) {
      showMessage($("#form-message"), "You are not signed in to a class.", "error");
      return;
    }
    state.history.push({ courseId: course.id, action: "signed-out", at: new Date().toISOString() });
    state.signedInCourseId = null;
    state.signedInGroupId = null;
    saveState();
    render();
    showMessage($("#form-message"), `You've signed out of ${course.name}. Your attendance is saved.`, "success");
  }

  async function startScanner() {
    showMessage($("#scan-message"), "", "");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMessage($("#scan-message"), "Camera scanning isn't available here. Enter the fallback code below.", "error");
      return;
    }
    if (!("BarcodeDetector" in window)) {
      showMessage($("#scan-message"), "QR scanning isn't supported by this browser. Enter the fallback code below.", "error");
      return;
    }
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      const video = $("#scanner-video");
      video.srcObject = cameraStream;
      video.classList.remove("is-hidden");
      $("#scanner-placeholder").classList.add("is-hidden");
      $("#start-scan").classList.add("is-hidden");
      $("#stop-scan").classList.remove("is-hidden");
      await video.play();
      showMessage($("#scan-message"), "Point your camera at your teacher's QR code.", "");
      scanInProgress = false;
      scanTimer = window.setInterval(async () => {
        if (scanInProgress || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        scanInProgress = true;
        try {
          const codes = await detector.detect(video);
          if (codes.length && codes[0].rawValue) {
            const value = codes[0].rawValue.trim().toUpperCase();
            const parts = value.split(":");
            let group = null;
            let course = null;
            let code = value;
            if (parts.length === 3) {
              group = classGroups.find((item) => item.qrId === parts[0]) || null;
              course = getCourse(parts[1].toLowerCase());
              code = parts[2];
              if (!group || !course || !group.subjectIds.includes(course.id)) {
                showMessage($("#scan-message"), "That QR code isn't for a class in this demo. Try the displayed class QR or enter the code manually.", "error");
                return;
              }
              $("#student-group-select").value = group.id;
              renderCourseOptions();
              $("#course-select").value = course.id;
            } else if (parts.length === 2) {
              course = getCourse(parts[0].toLowerCase());
              group = getGroup($("#student-group-select").value);
              code = parts[1];
              if (!course || !group || !group.subjectIds.includes(course.id)) {
                showMessage($("#scan-message"), "Choose the matching year, branch, and section, or scan that class's QR.", "error");
                return;
              }
              $("#course-select").value = course.id;
            }
            $("#fallback-code").value = code;
            stopScanner();
            showMessage($("#scan-message"), group && course ? `QR scanned for ${group.year} ${group.branch} Section ${group.section}, ${course.name}. Checking you in…` : "QR scanned. Checking you in…", "success");
            signIn({ preventDefault() {} });
          }
        } catch (error) {
          console.error("Could not read a QR code from the camera.", error);
          showMessage($("#scan-message"), "Couldn't read that QR. Try again or enter the fallback code.", "error");
        } finally {
          scanInProgress = false;
        }
      }, 350);
    } catch (error) {
      console.error("Could not start the camera scanner.", error);
      stopScanner();
      const message = error.name === "NotAllowedError"
        ? "Camera permission was denied. You can still enter the fallback code."
        : "Camera couldn't be started. You can still enter the fallback code.";
      showMessage($("#scan-message"), message, "error");
    }
  }

  function stopScanner() {
    if (scanTimer) window.clearInterval(scanTimer);
    scanTimer = null;
    scanInProgress = false;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    const video = $("#scanner-video");
    if (video) {
      video.srcObject = null;
      video.classList.add("is-hidden");
    }
    const placeholder = $("#scanner-placeholder");
    if (placeholder) placeholder.classList.remove("is-hidden");
    const startButton = $("#start-scan");
    if (startButton) startButton.classList.remove("is-hidden");
    const stopButton = $("#stop-scan");
    if (stopButton) stopButton.classList.add("is-hidden");
  }

  $(".role-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-role]");
    if (button) setRole(button.dataset.role);
  });
  $("#go-to-checkin").addEventListener("click", openCheckin);
  $("#back-to-dashboard").addEventListener("click", () => setRole("student"));
  $("#show-all-courses").addEventListener("click", () => $("#course-grid").scrollIntoView({ behavior: "smooth", block: "center" }));
  $("#checkin-form").addEventListener("submit", signIn);
  $("#absence-request-form").addEventListener("submit", submitAbsenceRequest);
  $("#absence-group").addEventListener("change", renderAbsenceFormOptions);
  $("#absence-document").addEventListener("change", () => {
    $("#absence-file-hint").textContent = $("#absence-document").files.length
      ? "Supporting document selected · preview only"
      : "Supporting document attachment · preview only";
  });
  $("#sign-out-button").addEventListener("click", signOut);
  $("#start-scan").addEventListener("click", startScanner);
  $("#stop-scan").addEventListener("click", stopScanner);
  $("#teacher-group-select").addEventListener("change", (event) => {
    selectedTeacherGroupId = event.currentTarget.value;
    const group = getGroup(selectedTeacherGroupId);
    if (group && !group.subjectIds.includes(selectedTeacherCourseId)) selectedTeacherCourseId = group.subjectIds[0];
    showMessage($("#teacher-message"), "", "");
    renderTeacher();
  });
  $("#teacher-course-select").addEventListener("change", (event) => {
    selectedTeacherCourseId = event.currentTarget.value;
    showMessage($("#teacher-message"), "", "");
    renderTeacher();
  });
  $("#student-group-select").addEventListener("change", () => {
    renderCourseOptions();
    showMessage($("#form-message"), "", "");
  });
  $("#course-select").addEventListener("change", () => showMessage($("#form-message"), "", ""));
  window.addEventListener("pagehide", () => {
    stopScanner();
    if (teacherCodeTimer) window.clearInterval(teacherCodeTimer);
  });

  render();
  teacherCodeTimer = window.setInterval(refreshTeacherCodes, 1000);
})();
