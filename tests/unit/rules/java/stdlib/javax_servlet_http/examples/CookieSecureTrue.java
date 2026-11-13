// level: NONE
import javax.servlet.http.Cookie;


public class CookieSecureTrue {
    public static void main(String[] args) {
        Cookie cookie = new Cookie("cookieName", "cookieValue");
        cookie.setHttpOnly(true);
        cookie.setSecure(true);
    }
}
