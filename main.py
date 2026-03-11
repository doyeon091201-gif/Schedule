import pandas as pd
import json

# 엑셀 파일 읽기
df = pd.read_excel("A_time.xlsx", header=None)

subjects = [
    ("주제 탐구 독서", "203"),
    ("세계사", "205"),
    ("현대사회와 윤리", "202"),
    ("한국지리 탐구", "201"),
    ("물리학", "206"),
    ("화학", "208"),
    ("생명과학", "204"),
    ("지구과학", "207")
]

students = []

# 각 과목 블록은 3열씩 (순, 학번, 이름)
for i, (subject, room) in enumerate(subjects):
    start_col = i * 3

    for row in range(3, 30):  # 실제 학생 데이터 영역
        student_id = df.iloc[row, start_col + 1]
        name = df.iloc[row, start_col + 2]

        if pd.isna(student_id) or pd.isna(name):
            continue

        student_id = str(int(student_id))

        grade = int(student_id[0])
        class_num = int(student_id[1:3])
        number = int(student_id[3:5])

        students.append({
            "studentId": student_id,
            "grade": grade,
            "class": class_num,
            "number": number,
            "name": name,
            "slots": {
                "A": {
                    "subject": subject,
                    "room": room
                }
            }
        })

data = {"students": students}

print(json.dumps(data, ensure_ascii=False, indent=2))