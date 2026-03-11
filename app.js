// 기본 설정 -----------------------------

const PERIODS = [
  { no: 1, time: "08:35" },
  { no: 2, time: "09:35" },
  { no: 3, time: "10:35" },
  { no: 4, time: "11:35" },
  { no: 5, time: "13:35" },
  { no: 6, time: "14:35" },
  { no: 7, time: "15:35" },
  { no: 8, time: "16:35" },
];

const DAYS = ["월", "화", "수", "목", "금"];

// API weekday(1~5) → 요일 문자열 매핑
const WEEKDAY_MAP = {
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
};

// 외부 시간표 API 설정 -----------------------
// 브라우저 → (내 로컬 Flask 서버) → 외부 API 로 요청을 우회하는 구조
// timetable_server.py 에서 5000 포트로 띄운 /api/timetable 엔드포인트를 사용

const TIMETABLE_API_BASE = "http://127.0.0.1:5000/api/timetable";

/**
 * 외부 시간표 API에서 받은 raw 데이터를 이 앱에서 사용하는 형식으로 변환
 * @param {object} apiData - 외부 API 전체 응답
 * @param {number} grade - 학년
 * @param {number} classNo - 반
 * @returns {{grade:number, classNo:number, lessons:Array}}
 */
function convertApiTimetableToInternal(apiData, grade, classNo) {
  console.log("[DEBUG] convertApiTimetableToInternal 시작:", { grade, classNo });
  
  if (!apiData || !apiData.timetable) {
    console.error("[ERROR] API 응답 구조 오류:", {
      hasApiData: !!apiData,
      hasTimetable: !!(apiData && apiData.timetable),
      keys: apiData ? Object.keys(apiData) : [],
    });
    throw new Error("API 응답에 timetable 데이터가 없습니다.");
  }

  const gradeKey = String(grade);
  const classKey = String(classNo);

  console.log("[DEBUG] timetable 구조:", {
    availableGrades: Object.keys(apiData.timetable),
    requestedGrade: gradeKey,
  });

  const gradeData = apiData.timetable[gradeKey];
  if (!gradeData) {
    console.error("[ERROR] 학년 데이터 없음:", {
      requestedGrade: gradeKey,
      availableGrades: Object.keys(apiData.timetable),
    });
    throw new Error(`${grade}학년 시간표 데이터를 찾을 수 없습니다. (사용 가능한 학년: ${Object.keys(apiData.timetable).join(", ")})`);
  }

  console.log("[DEBUG] 학년 데이터 찾음, 사용 가능한 반:", Object.keys(gradeData));

  const classData = gradeData[classKey];
  if (!classData) {
    console.error("[ERROR] 반 데이터 없음:", {
      requestedClass: classKey,
      availableClasses: Object.keys(gradeData),
    });
    throw new Error(`${grade}학년 ${classNo}반 시간표 데이터를 찾을 수 없습니다. (사용 가능한 반: ${Object.keys(gradeData).join(", ")})`);
  }

  console.log("[DEBUG] 반 데이터 찾음, 타입:", typeof classData, "길이:", Array.isArray(classData) ? classData.length : "N/A");

  const lessons = [];

  /**
   * API 형식 예시 (학급 기준):
   * timetable: {
   *   "1": {       // 1학년
   *     "1": [     // 1반
   *       [],      // 월
   *       [],      // 화
   *       [],      // 수
   *       [ { grade:1, class:1, weekday:4, weekdayString:"목", classTime:1, ... }, ... ],
   *       [ { grade:1, class:1, weekday:5, weekdayString:"금", classTime:1, ... }, ... ]
   *     ],
   *     "2": [ ... ], // 2반
   *     ...
   *   },
   *   "2": { ... }    // 2학년
   * }
   */

  classData.forEach((dayArray, weekdayIdx) => {
    if (!Array.isArray(dayArray)) return;

    dayArray.forEach((item) => {
      if (!item || !item.subject) return;

      // 요일 문자열 결정 (weekdayString 우선, 없으면 weekday 숫자 사용)
      let dayLabel = item.weekdayString;
      if (!dayLabel) {
        const w = typeof item.weekday === "number" ? item.weekday : undefined;
        if (w && WEEKDAY_MAP[w]) {
          dayLabel = WEEKDAY_MAP[w];
        } else {
          // 둘 다 없으면 배열 인덱스로 추론 (0~4 → 월~금)
          dayLabel = DAYS[weekdayIdx] || "월";
        }
      }

      lessons.push({
        day: dayLabel,
        period: item.classTime, // 1~8 교시
        name: item.subject,
        teacher: item.teacher || "",
        // API에서 받은 type이 있으면 유지
        // 없을 때는 과목명이 A/B/C/D로 끝나면 elective, 아니면 core
        type: item.type || (/[ABCD]$/.test(item.subject) ? "elective" : "core"),
      });
    });
  });

  return {
    grade,
    classNo,
    lessons,
  };
}

/**
 * 외부 시간표 API에서 특정 학년/반 시간표를 가져오는 함수
 * @param {number} grade
 * @param {number} classNo
 * @param {number} periodIndex - API의 period(주차) 파라미터, 기본 1
 */
async function loadTimetableFromApi(grade, classNo, periodIndex = 1) {
  // 외부 API 호출은 Python 프록시 서버(timetable_server.py)가 대신 해줌
  const url = `${TIMETABLE_API_BASE}?period=${periodIndex}`;
  
  console.log(`[DEBUG] 시간표 API 호출 시작: ${url}, 학년=${grade}, 반=${classNo}`);

  try {
    const res = await fetch(url);
    
    if (!res.ok) {
      let errorData = null;
      let errorMessage = `시간표 API 호출 실패: ${res.status} ${res.statusText}`;
      
      try {
        const bodyText = await res.text();
        try {
          errorData = JSON.parse(bodyText);
          // 서버에서 제공한 친화적인 메시지가 있으면 사용
          if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } catch (e) {
          // JSON이 아니면 텍스트 그대로 사용
          errorMessage = bodyText || errorMessage;
        }
      } catch (e) {
        console.warn("응답 본문을 읽는 중 오류:", e);
      }
      
      console.error("시간표 API 호출 실패:", res.status, res.statusText, errorData || "(응답 본문 없음)");
      
      // 특정 오류 코드에 대한 친화적인 메시지
      if (res.status === 502) {
        errorMessage = "시간표 서버가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.";
      } else if (res.status === 503) {
        errorMessage = "시간표 서버가 점검 중이거나 과부하 상태입니다. 잠시 후 다시 시도해주세요.";
      } else if (res.status === 504) {
        errorMessage = "시간표 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
      }
      
      const error = new Error(errorMessage);
      error.status = res.status;
      error.errorData = errorData;
      throw error;
    }

    const data = await res.json();
    console.log("[DEBUG] API 응답 받음, 데이터 구조:", {
      hasTimetable: !!data.timetable,
      grades: data.timetable ? Object.keys(data.timetable) : [],
    });
    
    return convertApiTimetableToInternal(data, grade, classNo);
  } catch (error) {
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      console.error("[ERROR] 네트워크 오류 - Flask 서버가 실행 중인지 확인하세요:", error);
      throw new Error("Flask 서버에 연결할 수 없습니다. timetable_server.py를 실행했는지 확인하세요.");
    }
    // 이미 처리된 에러는 그대로 전달
    throw error;
  }
}

// 예시 시간표 데이터 (첨부한 이미지와 비슷하게)
// 나중에 선택 과목 / API 연동 시 이 부분만 바꾸면 됩니다.
const exampleTimetable = {
  grade: 2,
  classNo: 1,
  lessons: [
    // 월요일
    { day: "월", period: 1, name: "D", teacher: "", type: "elective" },
    { day: "월", period: 2, name: "대수", teacher: "이상", type: "core" },
    { day: "월", period: 3, name: "영어1", teacher: "김재", type: "core" },
    { day: "월", period: 4, name: "B", teacher: "", type: "elective" },
    { day: "월", period: 5, name: "문학", teacher: "한서", type: "core" },
    { day: "월", period: 6, name: "공강", teacher: "", type: "core" },
    { day: "월", period: 7, name: "스생1", teacher: "안율", type: "core" },

    // 화요일
    { day: "화", period: 1, name: "C", teacher: "", type: "elective" },
    { day: "화", period: 2, name: "대수", teacher: "이상", type: "core" },
    { day: "화", period: 3, name: "A", teacher: "", type: "elective" },
    { day: "화", period: 4, name: "스생1", teacher: "안율", type: "core" },
    { day: "화", period: 5, name: "문학", teacher: "권오", type: "core" },
    { day: "화", period: 6, name: "영어1", teacher: "김재", type: "core" },
    { day: "화", period: 7, name: "B", teacher: "", type: "elective" },

    // 수요일
    { day: "수", period: 1, name: "한문", teacher: "오국", type: "core" },
    { day: "수", period: 2, name: "영어1", teacher: "김재", type: "core" },
    { day: "수", period: 3, name: "D", teacher: "", type: "elective" },
    { day: "수", period: 4, name: "C", teacher: "", type: "elective" },
    { day: "수", period: 5, name: "공강", teacher: "박끔", type: "core" },
    { day: "수", period: 6, name: "공강", teacher: "오국", type: "core" },
    { day: "수", period: 7, name: "A", teacher: "", type: "elective" },

    // 목요일
    { day: "목", period: 1, name: "대수", teacher: "이상", type: "core" },
    { day: "목", period: 2, name: "D", teacher: "", type: "elective" },
    { day: "목", period: 3, name: "문학", teacher: "한서", type: "core" },
    { day: "목", period: 4, name: "한문", teacher: "오국", type: "core" },
    { day: "목", period: 4, name: "B", teacher: "오국", type: "elective" },

    // 금요일
    { day: "금", period: 1, name: "자율", teacher: "이상", type: "core" },
    { day: "금", period: 2, name: "문학", teacher: "권오", type: "core" },
    { day: "금", period: 3, name: "대수", teacher: "이상", type: "core" },
    { day: "금", period: 4, name: "A", teacher: "", type: "elective" },
    { day: "금", period: 5, name: "C", teacher: "", type: "elective" },
    { day: "금", period: 6, name: "영어1", teacher: "김재", type: "core" },
    { day: "금", period: 7, name: "한문", teacher: "오국", type: "core" },
  ],
};

// DOM 헬퍼 --------------------------------

function $(selector) {
  return document.querySelector(selector);
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// 선택 과목 데이터 (학생별) ---------------

let studentMap = {}; // key: studentId, value: student object
let activeStudent = null;
let studentDataLoaded = false;

async function loadStudentInfo() {
  try {
    const res = await fetch("student_info.json");
    if (!res.ok) {
      console.warn("student_info.json 로드 실패:", res.status);
      return;
    }
    const data = await res.json();
    const map = {};
    (data.students || []).forEach((s) => {
      map[String(s.studentId)] = s;
    });
    studentMap = map;
    studentDataLoaded = true;
  } catch (err) {
    console.error("student_info.json 로드 중 오류:", err);
  }
}

// 시간표 렌더링 ----------------------------

function renderTimetable(timetable) {
  const grid = $("#timetableGrid");

  // 기존 행 제거 (헤더 6칸 제외)
  while (grid.children.length > 6) {
    grid.removeChild(grid.lastChild);
  }

  PERIODS.forEach((p) => {
    // 교시 / 시간 세로 헤더
    const periodCell = createElement("div", "cell cell-period");
    const number = createElement("div", "period-number", `${p.no}교시`);
    const time = createElement("div", "period-time", p.time);
    periodCell.appendChild(number);
    periodCell.appendChild(time);
    grid.appendChild(periodCell);

    DAYS.forEach((day) => {
      const lessonCell = createElement("div", "cell cell-lesson");

      const lesson = timetable.lessons.find(
        (l) => l.day === day && l.period === p.no
      );

      if (!lesson) {
        const empty = createElement("div", "lesson-empty", "-");
        lessonCell.appendChild(empty);
      } else {
        let displayName = lesson.name;
        // let timestatus = lesson.type;
        let subLine = "";

        if (
          activeStudent &&
          (lesson.name[lesson.name.length - 1] === "A" || lesson.name[lesson.name.length - 1] === "a") &&
          activeStudent.slots &&
          activeStudent.slots.A
        ) {
          displayName = activeStudent.slots.A.subject;
          const room = activeStudent.slots.A.room;
          if (room) {
            console.log("선택 수업 정보 로드 성공");
            subLine = `A타임 · ${room.replace("0", "-")}반`;
          } else {
            subLine = "A타임";
          }
        }

        if (
          activeStudent &&
          (lesson.name[lesson.name.length - 1] === "B") &&
          activeStudent.slots &&
          activeStudent.slots.B
        ) {
          displayName = activeStudent.slots.B.subject;
          const room = activeStudent.slots.B.room;
          if (room) {
            console.log("선택 수업 정보 로드 성공");
            subLine = `B타임 · ${room.replace("0", "-")}반`;
          }
        }

        if (
          activeStudent &&
          (lesson.name[lesson.name.length - 1] === "C") &&
          activeStudent.slots &&
          activeStudent.slots.C
        ) {
          displayName = activeStudent.slots.C.subject;
          const room = activeStudent.slots.C.room;
          if (room) {
            console.log("선택 수업 정보 로드 성공");
            subLine = `C타임 · ${room.replace("0", "-")}반`;
          }
        }

        if (
          activeStudent &&
          (lesson.name[lesson.name.length - 1] === "D") &&
          activeStudent.slots &&
          activeStudent.slots.D
        ) {
          displayName = activeStudent.slots.D.subject;
          const room = activeStudent.slots.D.room;
          if (room) {
            console.log("선택 수업 정보 로드 성공");
            subLine = `D타임 · ${room.replace("0", "-")}반`;
          }
        }

        const card = createElement(
          "div",
          `lesson-card ${lesson.type === "elective" ? "elective" : "core"}`
        );
        const name = createElement("div", "lesson-name", displayName);
        
        // subLine이 있으면 항상 우선 표시, 없으면 teacher 표시
        let teacherText = "";
        if (subLine) {
          teacherText = subLine;
        } else if (lesson.teacher) {
          teacherText = lesson.teacher;
        }
        
        if (teacherText) {
          const teacher = createElement("div", "lesson-teacher", teacherText);
          card.appendChild(name);
          card.appendChild(teacher);
        } else {
          card.appendChild(name);
        }
        lessonCell.appendChild(card);
      }

      grid.appendChild(lessonCell);
    });
  });
}

// 학번 파싱 및 표시 -------------------------

/**
 * 학번 형식: 학년 + 반 + 번호
 *  - 5자리 예: 20106 -> 2학년 1반 06번
 *  - 4자리 예: 2106  -> 2학년 1반 06번
 */
function parseStudentId(raw) {
  const trimmed = (raw || "").trim();
  if (!/^\d{4,5}$/.test(trimmed)) {
    return null;
  }

  const grade = Number(trimmed[0]);
  const number = Number(trimmed.slice(-2)); // 마지막 두 자리

  let classPart = trimmed.slice(1, -2);
  if (classPart.length === 0) {
    return null;
  }
  // 앞자리 0 허용 (01, 02 ...)
  const classNo = Number(classPart);

  if (!grade || !classNo || !number) {
    return null;
  }

  return { grade, classNo, number };
}

function updateWeekInfoFromStudent(parsed) {
  if (!parsed) {
    $("#weekInfo").textContent = "학번을 입력하세요";
    return;
  }
  $("#weekInfo").textContent = `${parsed.grade}학년 ${parsed.classNo}반 ${String(
    parsed.number
  ).padStart(2, "0")}번`;
}

function setupStudentIdInput() {
  const input = $("#studentIdInput");
  const button = $("#applyStudentIdButton");

  async function apply() {
    const parsed = parseStudentId(input.value);
    if (!parsed) {
      alert("학번 형식이 올바르지 않습니다.\n예: 20106 또는 2106");
      input.focus();
      return;
    }

    // 학생 정보 매핑 (학년 + 두 자리 반 + 두 자리 번호)
    // 예) 2학년 1반 6번 → 20106 , 2학년 6반 12번 → 20612
    const studentId = `${parsed.grade}${String(parsed.classNo).padStart(
      2,
      "0"
    )}${String(parsed.number).padStart(2, "0")}`;

    if (!studentDataLoaded) {
      alert("학생 선택과목 정보가 아직 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.");
    }

    activeStudent = studentMap[studentId] || null;

    if (!activeStudent) {
      alert("해당 학번의 A타임 선택과목 정보를 찾을 수 없습니다.");
    }

    // 학생 정보에 맞게 상단 텍스트 및 시간표 갱신
    updateWeekInfoFromStudent(parsed);

    // 외부 시간표 API에서 해당 학년/반 시간표를 불러와서 렌더링
    try {
      const timetable = await loadTimetableFromApi(
        parsed.grade,
        parsed.classNo,
        1 // period = 1주차
      );
      renderTimetable(timetable);
    } catch (e) {
      console.error("시간표 API 호출 중 오류, 예시 시간표로 대체:", e);
      
      // 에러 메시지 구성
      let errorMessage = "실제 시간표를 불러오는 데 실패했습니다.";
      
      if (e.message) {
        errorMessage = e.message;
      } else if (e.status) {
        if (e.status === 502 || e.status === 503) {
          errorMessage = "시간표 서버가 일시적으로 사용할 수 없습니다.\n잠시 후 다시 시도해주세요.";
        } else if (e.status === 504) {
          errorMessage = "시간표 서버 응답 시간이 초과되었습니다.\n잠시 후 다시 시도해주세요.";
        }
      }
      
      alert(`${errorMessage}\n\n임시 예시 시간표를 대신 표시합니다.`);
      renderTimetable(exampleTimetable);
    }
  }

  button.addEventListener("click", apply);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      apply();
    }
  });
}

// "사진으로 저장" 버튼 (향후 구현용) -------

function setupSaveButton() {
  const btn = $("#saveImageButton");
  btn.addEventListener("click", () => {
    alert("이미지 저장 기능은 추후 앱/백엔드와 연동해서 구현할 예정입니다.");
  });
}

// 초기화 -----------------------------------

document.addEventListener("DOMContentLoaded", () => {
  loadStudentInfo();
  renderTimetable(exampleTimetable);
  setupStudentIdInput();
  setupSaveButton();
  // 초기 안내 문구
  updateWeekInfoFromStudent(null);
});

