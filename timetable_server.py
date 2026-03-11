import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
import time

app = Flask(__name__)
CORS(app)  # CORS 문제 해결

EXTERNAL_API_BASE = "https://api.xn--s39a564bmri.xn--hk3b17f.xn--3e0b707e/getalltimetable"
SCHOOL_CODE = "31372"
MAX_RETRIES = 3  # 최대 재시도 횟수
RETRY_DELAY = 1  # 재시도 간 대기 시간 (초)


def fetch_timetable_with_retry(period, max_retries=MAX_RETRIES):
    """
    외부 API를 재시도 로직과 함께 호출
    """
    last_error = None
    
    for attempt in range(1, max_retries + 1):
        try:
            print(f"[DEBUG] API 호출 시도 {attempt}/{max_retries}: period={period}")
            
            resp = requests.get(
                EXTERNAL_API_BASE,
                params={"schoolCode": SCHOOL_CODE, "period": period},
                timeout=15,  # 타임아웃 증가
            )
            resp.raise_for_status()
            
            print(f"[DEBUG] 외부 API 응답 성공: {resp.status_code}")
            return resp
            
        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response else None
            last_error = e
            
            # 502, 503, 504 같은 서버 오류는 재시도
            if status_code in [502, 503, 504] and attempt < max_retries:
                wait_time = RETRY_DELAY * attempt  # 지수 백오프
                print(f"[WARN] 서버 오류 {status_code} 발생, {wait_time}초 후 재시도... ({attempt}/{max_retries})")
                time.sleep(wait_time)
                continue
            else:
                print(f"[ERROR] HTTP 오류 {status_code}: {e}")
                raise
                
        except requests.exceptions.Timeout:
            last_error = "타임아웃"
            if attempt < max_retries:
                wait_time = RETRY_DELAY * attempt
                print(f"[WARN] 타임아웃 발생, {wait_time}초 후 재시도... ({attempt}/{max_retries})")
                time.sleep(wait_time)
                continue
            else:
                print("[ERROR] 외부 API 타임아웃 (최대 재시도 횟수 초과)")
                raise requests.exceptions.Timeout("외부 API 호출 시간 초과")
                
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < max_retries:
                wait_time = RETRY_DELAY * attempt
                print(f"[WARN] 요청 오류 발생, {wait_time}초 후 재시도... ({attempt}/{max_retries}): {e}")
                time.sleep(wait_time)
                continue
            else:
                print(f"[ERROR] 외부 API 호출 실패 (최대 재시도 횟수 초과): {e}")
                raise
    
    # 모든 재시도 실패
    raise Exception(f"외부 API 호출 실패 (재시도 {max_retries}회 모두 실패): {last_error}")


@app.route("/api/timetable", methods=["GET"])
def proxy_timetable():
    """
    외부 시간표 API를 서버에서 대신 호출해서,
    브라우저가 CORS 문제 없이 사용할 수 있도록 프록시해 주는 엔드포인트.
    쿼리: ?period=1
    """
    period = request.args.get("period", "1")
    
    try:
        resp = fetch_timetable_with_retry(period)
        
        try:
            data = resp.json()
            print(f"[DEBUG] JSON 파싱 성공, timetable 키 존재: {'timetable' in data}")
        except Exception as e:
            print(f"[ERROR] JSON 파싱 실패: {e}")
            return jsonify({
                "error": "invalid_json_from_external_api",
                "detail": str(e),
                "message": "외부 API 응답을 파싱하는 중 오류가 발생했습니다."
            }), 502

        return jsonify(data)
        
    except requests.exceptions.Timeout:
        print("[ERROR] 외부 API 타임아웃")
        return jsonify({
            "error": "timeout",
            "detail": "외부 API 호출 시간 초과",
            "message": "시간표 서버에 연결하는 데 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요."
        }), 504
        
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response else None
        print(f"[ERROR] 외부 API HTTP 오류 {status_code}: {e}")
        
        if status_code == 502:
            error_msg = "시간표 서버가 일시적으로 사용할 수 없습니다. (Bad Gateway)"
        elif status_code == 503:
            error_msg = "시간표 서버가 점검 중이거나 과부하 상태입니다. (Service Unavailable)"
        elif status_code == 504:
            error_msg = "시간표 서버 응답 시간 초과. (Gateway Timeout)"
        else:
            error_msg = f"시간표 서버 오류: {status_code}"
            
        return jsonify({
            "error": "server_error",
            "status_code": status_code,
            "detail": str(e),
            "message": error_msg
        }), 502
        
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] 외부 API 호출 실패: {e}")
        return jsonify({
            "error": "failed_to_fetch_external_api",
            "detail": str(e),
            "message": "시간표 서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요."
        }), 502
        
    except Exception as e:
        print(f"[ERROR] 예상치 못한 오류: {e}")
        return jsonify({
            "error": "unknown_error",
            "detail": str(e),
            "message": "예상치 못한 오류가 발생했습니다."
        }), 500


if __name__ == "__main__":
    # 예: http://127.0.0.1:5000/api/timetable?period=1
    app.run(host="127.0.0.1", port=5000, debug=True)

