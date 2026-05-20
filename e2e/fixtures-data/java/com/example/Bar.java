package com.example;

import com.example.Foo;
import static com.example.utils.Utils.parseInt;

public class Bar {
    private final Foo foo;

    public Bar(Foo foo) {
        this.foo = foo;
    }

    public int describe(String input) {
        int parsed = parseInt(input);
        return parsed + foo.greet().length();
    }
}
