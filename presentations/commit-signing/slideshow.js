var slideIndex = 1;

function showSlide(index) {
    var elements = document.getElementsByTagName('section');

    if (index > elements.length) {
        return;
    }

    if (index < 1) {
        return;
    }

    for(var i = 1; i <= elements.length; i++) {
        if (i == index) {
            elements[i-1].className = "current";
            continue;
        }

        elements[i-1].className = "";
    }

    slideIndex = index;
}

function toggleGlitch() {
    var body = document.getElementsByTagName('body')[0];

    if (body.classList.contains('no-glitch')) {
        body.className = "";
        return;
    }

    body.className = "no-glitch";
}

function keyPress(e) {
    // left and right arrow for navigation
    if (e.keyCode == '37')
        showSlide(slideIndex - 1);

    if (e.keyCode == '39')
        showSlide(slideIndex + 1);

    // pressing a toggles the glitch animation
    if (e.keyCode == '65')
        toggleGlitch();
}

document.addEventListener("keydown", keyPress);

window.addEventListener(
    "load",
    e => {
        showSlide(slideIndex);
    });
