package com.example

import com.example.Foo
import com.example.utils.parseInt

class Bar(private val foo: Foo) {
    fun describe(input: String): Int {
        val parsed = parseInt(input)
        return parsed + foo.greet().length
    }
}
