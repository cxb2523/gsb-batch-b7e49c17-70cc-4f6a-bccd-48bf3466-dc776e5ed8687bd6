// level: WARNING
// start_line: 13
// end_line: 13
// start_column: 25
// end_column: 30
import javax.servlet.http.Cookie;


public class CookieSecureFalse {
    public static void main(String[] args) {
        Cookie cookie = new Cookie("cookieName", "cookieValue");
        cookie.setHttpOnly(true);
        cookie.setSecure(false);
    }
}
