// 收录自 geomagnetism 0.2.0（https://github.com/naturalatlas/geomagnetism，Apache-2.0，许可全文见 licenses/geomagnetism-LICENSE.txt）
// 修改：CommonJS 改写为 ES 模块。
export default Ellipsoid;

function Ellipsoid(options) {
    options = options || {
        a: 6378.137,
        b: 6356.7523142,
        fla: 1 / 298.257223563,
        re: 6371.2
    };

    this.a = options.a; // semi-major axis
    this.b = options.b; // semi-minor axis
    this.fla = options.fla; // flattening
    this.re = options.re; // mean radius
    this.eps = Math.sqrt(1-(this.b*this.b)/(this.a*this.a)); // first eccentricity
    this.epssq = this.eps*this.eps; // first eccentricity squared
}